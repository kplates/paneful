import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const EDITOR_PATTERNS = ['cursor', 'code', 'vscode', 'visual studio code', 'zed', 'windsurf', 'electron'];

// Long-lived osascript fallback — same as before.
const STREAMING_SCRIPT = `
repeat
  try
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
      set winTitle to ""
      tell process frontApp
        if exists front window then
          set winTitle to name of front window
        end if
      end tell
    end tell
    log frontApp & "\\t" & winTitle
  end try
  delay 0.75
end repeat
`;

// Swift helper: event-driven app switches via NSWorkspace, AX observer for window/title changes.
const SWIFT_SOURCE = `
import Cocoa

let editorPatterns: [String] = ["cursor", "code", "vscode", "visual studio code", "zed", "windsurf", "electron"]

func isEditor(_ name: String) -> Bool {
    let lower = name.lowercased()
    return editorPatterns.contains { lower.contains($0) }
}

func getWindowTitle(pid: pid_t) -> String {
    let app = AXUIElementCreateApplication(pid)
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &value) == .success else {
        return ""
    }
    var title: AnyObject?
    guard AXUIElementCopyAttributeValue(value as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success else {
        return ""
    }
    return title as? String ?? ""
}

setbuf(stdout, nil)
setbuf(stderr, nil)

let startTime = CFAbsoluteTimeGetCurrent()
func log(_ msg: String) {
    let elapsed = String(format: "%.3f", CFAbsoluteTimeGetCurrent() - startTime)
    fputs("[swift +\\(elapsed)s] \\(msg)\\n", stderr)
}

var lastOutput = ""
var currentPid: pid_t = 0
var currentAppName = ""
var axObserver: AXObserver?
var observedWindow: AXUIElement?
var fallbackTimer: Timer?

func emit(_ appName: String, _ title: String, source: String) {
    let output = "\\(appName)\\t\\(title)"
    guard output != lastOutput else { return }
    lastOutput = output
    log("emit (\\(source)): \\(appName) | \\(title.isEmpty ? "(no title)" : title)")
    print(output)
}

func emitCurrentTitle(source: String) {
    let title = getWindowTitle(pid: currentPid)
    emit(currentAppName, title, source: source)
}

let axCallback: AXObserverCallback = { _, _, notification, _ in
    let name = notification as String
    if name == (kAXFocusedWindowChangedNotification as String) {
        log("AX: focused window changed")
        observeFocusedWindowTitle()
        emitCurrentTitle(source: "ax-window-change")
    } else if name == (kAXTitleChangedNotification as String) {
        log("AX: title changed")
        emitCurrentTitle(source: "ax-title-change")
    } else {
        emitCurrentTitle(source: "ax-\\(name)")
    }
}

func observeFocusedWindowTitle() {
    guard let obs = axObserver else { return }
    if let old = observedWindow {
        AXObserverRemoveNotification(obs, old, kAXTitleChangedNotification as CFString)
        observedWindow = nil
    }
    let app = AXUIElementCreateApplication(currentPid)
    var winValue: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &winValue) == .success else { return }
    let window = winValue as! AXUIElement
    AXObserverAddNotification(obs, window, kAXTitleChangedNotification as CFString, nil)
    observedWindow = window
}

func startObserving(pid: pid_t) {
    stopObserving()
    emitCurrentTitle(source: "editor-activated")

    var observer: AXObserver?
    guard AXObserverCreate(pid, axCallback, &observer) == .success, let obs = observer else {
        log("AXObserver failed for pid \\(pid), using poll fallback")
        fallbackTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            emitCurrentTitle(source: "poll")
        }
        return
    }

    let appElement = AXUIElementCreateApplication(pid)
    AXObserverAddNotification(obs, appElement, kAXFocusedWindowChangedNotification as CFString, nil)
    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
    axObserver = obs
    observeFocusedWindowTitle()
    log("AXObserver active for pid \\(pid)")

    // AX notifications don't fire for Electron apps (Cursor, VS Code, etc.)
    // so this timer is the primary mechanism for those editors
    fallbackTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
        emitCurrentTitle(source: "poll")
    }
}

func stopObserving() {
    if let obs = axObserver {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        axObserver = nil
        observedWindow = nil
    }
    fallbackTimer?.invalidate()
    fallbackTimer = nil
}

let nc = NSWorkspace.shared.notificationCenter
nc.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { notif in
    guard let app = notif.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
          let name = app.localizedName else { return }
    log("app switch: \\(name)")
    currentAppName = name
    currentPid = app.processIdentifier
    if isEditor(name) {
        startObserving(pid: currentPid)
    } else {
        stopObserving()
        emit(name, "", source: "app-switch")
    }
}

if let front = NSWorkspace.shared.frontmostApplication, let name = front.localizedName {
    log("seed: \\(name)")
    currentAppName = name
    currentPid = front.processIdentifier
    if isEditor(name) {
        startObserving(pid: currentPid)
    } else {
        emit(name, "", source: "seed")
    }
}

RunLoop.main.run()
`;

export class EditorMonitor {
  private onChange: (projectName: string) => void;
  private proc: ChildProcess | null = null;
  private destroyed = false;
  private lineBuffer = '';
  private cache: { projectName: string | null; needsAccessibility?: boolean } = { projectName: null };
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private mode: 'native' | 'osascript' = 'osascript';
  private compiling = false;

  constructor(onChange: (projectName: string) => void) {
    this.onChange = onChange;
  }

  getState(): { projectName: string | null; needsAccessibility?: boolean } {
    return this.cache;
  }

  private get helperPath(): string {
    return join(homedir(), '.paneful', 'paneful-editor-helper');
  }

  private get versionPath(): string {
    return this.helperPath + '.version';
  }

  private sourceHash(): string {
    return createHash('sha256').update(SWIFT_SOURCE).digest('hex').slice(0, 16);
  }

  private isHelperCurrent(): boolean {
    if (!existsSync(this.helperPath)) return false;
    try {
      const stored = readFileSync(this.versionPath, 'utf-8').trim();
      return stored === this.sourceHash();
    } catch {
      return false;
    }
  }

  private async compileHelper(): Promise<void> {
    if (this.compiling) return;
    this.compiling = true;

    const dir = join(homedir(), '.paneful');
    mkdirSync(dir, { recursive: true });

    const tmpSrc = join(tmpdir(), `paneful-editor-helper-${process.pid}.swift`);
    writeFileSync(tmpSrc, SWIFT_SOURCE);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          'swiftc',
          [tmpSrc, '-o', this.helperPath, '-framework', 'Cocoa', '-O'],
          { timeout: 60_000 },
          (err) => (err ? reject(err) : resolve()),
        );
        child.unref();
      });
      writeFileSync(this.versionPath, this.sourceHash());
    } finally {
      this.compiling = false;
      try { unlinkSync(tmpSrc); } catch {}
    }
  }

  resume(): void {
    if (this.destroyed || this.proc) return;
    if (process.platform !== 'darwin') return;

    if (this.isHelperCurrent()) {
      this.mode = 'native';
      console.log('[editor-monitor] native helper is current, starting directly');
      this.startProcess();
    } else {
      this.mode = 'osascript';
      console.log('[editor-monitor] native helper not found, starting osascript fallback');
      this.startProcess();

      console.log('[editor-monitor] compiling native helper in background...');
      this.compileHelper()
        .then(() => {
          if (this.destroyed) return;
          console.log('[editor-monitor] compilation done, hot-swapping to native helper');
          this.stopProcess();
          this.mode = 'native';
          this.startProcess();
        })
        .catch((err) => {
          console.log(`[editor-monitor] compilation failed, keeping osascript: ${(err as Error).message}`);
        });
    }
  }

  pause(): void {
    this.stopProcess();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopProcess();
  }

  private startProcess(): void {
    if (this.destroyed || this.proc) return;

    let proc: ChildProcess;

    if (this.mode === 'native') {
      proc = spawn(this.helperPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.proc = proc;
      this.lineBuffer = '';

      proc.stdout!.on('data', (chunk: Buffer) => {
        if (this.destroyed) return;
        this.feedData(chunk);
      });

      // Forward Swift helper's debug logs to server console
      let stderrBuf = '';
      proc.stderr!.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) console.log(`[editor-monitor] ${line.trim()}`);
        }
      });
    } else {
      proc = spawn('osascript', ['-e', STREAMING_SCRIPT], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      this.proc = proc;
      this.lineBuffer = '';

      proc.stderr!.on('data', (chunk: Buffer) => {
        if (this.destroyed) return;
        this.feedData(chunk);
      });
    }

    const currentMode = this.mode;

    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      const msg = err.message || '';
      const needsAccess = msg.includes('not allowed assistive access') || msg.includes('1719');
      this.cache = { projectName: null, needsAccessibility: needsAccess || undefined };
      this.proc = null;

      if (currentMode === 'native') {
        console.log(`[editor-monitor] native helper error, falling back to osascript: ${msg}`);
        this.mode = 'osascript';
      }
      this.scheduleRestart();
    });

    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (currentMode === 'native' && code !== 0) {
        console.log(`[editor-monitor] native helper exited (code ${code}), falling back to osascript`);
        this.mode = 'osascript';
      }
      this.scheduleRestart();
    });
  }

  private feedData(chunk: Buffer): void {
    this.lineBuffer += chunk.toString();
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      this.handleLine(line.trim());
    }
  }

  private stopProcess(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  private scheduleRestart(): void {
    if (this.destroyed) return;
    if (this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.destroyed && !this.proc) {
        this.startProcess();
      }
    }, 5000);
  }

  private handleLine(line: string): void {
    if (!line) return;

    const tabIdx = line.indexOf('\t');
    const appName = tabIdx >= 0 ? line.slice(0, tabIdx) : line;
    const title = tabIdx >= 0 ? line.slice(tabIdx + 1) : '';

    const isEditor = EDITOR_PATTERNS.some((pat) => appName.toLowerCase().includes(pat));
    if (!isEditor || !title) {
      this.cache = { projectName: null };
      return;
    }

    let projectName: string | null = null;

    const pathMatch = title.match(/^(~?\/[^\s]+)/);
    if (pathMatch) {
      const segments = pathMatch[1].replace(/\/$/, '').split('/');
      projectName = segments[segments.length - 1] || null;
    }

    if (!projectName) {
      const parts = title.split(' \u2014 ');
      if (parts.length >= 3) {
        projectName = parts[parts.length - 2];
      } else if (parts.length === 2) {
        projectName = parts[0];
      } else {
        projectName = title;
      }
    }

    const prev = this.cache.projectName;
    this.cache = { projectName };
    if (projectName && projectName !== prev) {
      this.onChange(projectName);
    }
  }
}
