import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const DEFAULT_APP_PATH = '/Applications/Paneful.app';
const BUNDLE_ID = 'com.paneful.app';

function findIconDir(): string | null {
  // Walk up from import.meta.dirname to find AppIcon.appiconset
  // Works from both dist/server/ (built) and server/ (dev)
  let dir = import.meta.dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'assets', 'icons');
    if (fs.existsSync(path.join(candidate, 'icon-mac-512x512.png'))) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

function buildIcns(iconDir: string, contentsDir: string): string | null {
  const iconsetDir = path.join(os.tmpdir(), 'Paneful.iconset');
  const icnsPath = path.join(contentsDir, 'Resources', 'Paneful.icns');

  try {
    fs.mkdirSync(iconsetDir, { recursive: true });

    // Map pre-sized PNGs to iconset naming convention
    const mappings: [string, string][] = [
      ['icon-mac-16x16.png', 'icon_16x16.png'],
      ['icon-mac-16x16@2x.png', 'icon_16x16@2x.png'],
      ['icon-mac-32x32.png', 'icon_32x32.png'],
      ['icon-mac-32x32@2x.png', 'icon_32x32@2x.png'],
      ['icon-mac-128x128.png', 'icon_128x128.png'],
      ['icon-mac-128x128@2x.png', 'icon_128x128@2x.png'],
      ['icon-mac-256x256.png', 'icon_256x256.png'],
      ['icon-mac-256x256@2x.png', 'icon_256x256@2x.png'],
      ['icon-mac-512x512.png', 'icon_512x512.png'],
      ['icon-mac-512x512@2x.png', 'icon_512x512@2x.png'],
    ];

    for (const [src, dest] of mappings) {
      const srcPath = path.join(iconDir, src);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(iconsetDir, dest));
      }
    }

    fs.mkdirSync(path.dirname(icnsPath), { recursive: true });
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'pipe' });

    // Cleanup
    fs.rmSync(iconsetDir, { recursive: true, force: true });

    return icnsPath;
  } catch {
    // Cleanup on failure
    try { fs.rmSync(iconsetDir, { recursive: true, force: true }); } catch { /* ok */ }
    return null;
  }
}

function getInfoPlist(hasIcon: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Paneful</string>
  <key>CFBundleDisplayName</key>
  <string>Paneful</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>Paneful</string>
${hasIcon ? `  <key>CFBundleIconFile</key>
  <string>Paneful</string>
` : ''}</dict>
</plist>
`;
}

function escapeSwiftString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getSwiftSource(): string {
  const bakedNode = escapeSwiftString(process.execPath);
  const bakedPaneful = escapeSwiftString(fs.realpathSync(process.argv[1]));

  return `import Cocoa
import WebKit

// Port is determined at runtime; read from lockfile after server starts
let HOME = NSHomeDirectory()
let DATA_DIR = HOME + "/.paneful"
let LOCKFILE = DATA_DIR + "/paneful.lock"
let LOG_FILE = DATA_DIR + "/app.log"
let BAKED_NODE = "${bakedNode}"
let BAKED_PANEFUL = "${bakedPaneful}"

var logHandle: FileHandle?

func log(_ msg: String) {
    guard let h = logHandle else { return }
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd HH:mm:ss"
    if let data = "[\\(df.string(from: Date()))] \\(msg)\\n".data(using: .utf8) {
        h.write(data)
    }
}

func findNode() -> String? {
    let fm = FileManager.default
    if fm.isExecutableFile(atPath: BAKED_NODE) { return BAKED_NODE }
    for p in ["/usr/local/bin/node", "/opt/homebrew/bin/node"] {
        if fm.isExecutableFile(atPath: p) { return p }
    }
    // nvm
    let nvmDir = HOME + "/.nvm/versions/node"
    if let vs = try? fm.contentsOfDirectory(atPath: nvmDir) {
        if let latest = vs.filter({ $0.hasPrefix("v") }).sorted().last {
            let p = "\\(nvmDir)/\\(latest)/bin/node"
            if fm.isExecutableFile(atPath: p) { return p }
        }
    }
    // fnm
    let fnmDir = HOME + "/.fnm/node-versions"
    if let vs = try? fm.contentsOfDirectory(atPath: fnmDir) {
        if let latest = vs.filter({ $0.hasPrefix("v") }).sorted().last {
            let p = "\\(fnmDir)/\\(latest)/installation/bin/node"
            if fm.isExecutableFile(atPath: p) { return p }
        }
    }
    // volta
    let volta = HOME + "/.volta/bin/node"
    if fm.isExecutableFile(atPath: volta) { return volta }
    return nil
}

func findPaneful(nodeDir: String) -> String? {
    let fm = FileManager.default
    if fm.fileExists(atPath: BAKED_PANEFUL) { return BAKED_PANEFUL }
    for p in ["/usr/local/bin/paneful", "/opt/homebrew/bin/paneful", nodeDir + "/paneful"] {
        if fm.isExecutableFile(atPath: p) {
            // Resolve symlink to get actual .js entry point
            if let dest = try? fm.destinationOfSymbolicLink(atPath: p) {
                let base = (p as NSString).deletingLastPathComponent
                return dest.hasPrefix("/") ? dest : base + "/" + dest
            }
            return p
        }
    }
    return nil
}

func readLockfile() -> (pid: pid_t, port: Int)? {
    guard let content = try? String(contentsOfFile: LOCKFILE, encoding: .utf8) else { return nil }
    let lines = content.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\\n")
    guard lines.count >= 2, let pid = pid_t(lines[0]), let port = Int(lines[1]) else { return nil }
    guard kill(pid, 0) == 0 else { return nil }
    return (pid, port)
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process?
    var ownedServer = false
    var port = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        try? FileManager.default.createDirectory(atPath: DATA_DIR, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: LOG_FILE, contents: nil)
        logHandle = FileHandle(forWritingAtPath: LOG_FILE)
        logHandle?.seekToEndOfFile()
        log("--- App launched ---")

        setupMenuBar()

        if let lock = readLockfile() {
            log("Server already running on port \\(lock.port), connecting")
            port = lock.port
            createWindow()
        } else {
            log("Starting server")
            if startServer() {
                ownedServer = true
                waitForLockfile(attempt: 0)
            } else {
                let a = NSAlert()
                a.messageText = "Paneful"
                a.informativeText = "Failed to start server.\\nMake sure Node.js and paneful are installed.\\nCheck ~/.paneful/app.log"
                a.alertStyle = .critical
                a.runModal()
                NSApp.terminate(nil)
            }
        }
    }

    func startServer() -> Bool {
        guard let node = findNode() else { log("ERROR: node not found"); return false }
        log("Using node: \\(node)")
        let nodeDir = (node as NSString).deletingLastPathComponent
        guard let paneful = findPaneful(nodeDir: nodeDir) else { log("ERROR: paneful not found"); return false }
        log("Using paneful: \\(paneful)")

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: node)
        proc.arguments = [paneful]
        var env = ProcessInfo.processInfo.environment
        env["PANEFUL_APP"] = "1"
        proc.environment = env
        do {
            try proc.run()
            serverProcess = proc
            log("Server started (PID: \\(proc.processIdentifier))")
            return true
        } catch {
            log("Failed to start: \\(error)")
            return false
        }
    }

    func waitForLockfile(attempt: Int) {
        if attempt > 50 {
            log("Server did not start in time")
            let a = NSAlert()
            a.messageText = "Paneful"
            a.informativeText = "Server failed to start in time.\\nCheck ~/.paneful/app.log"
            a.alertStyle = .critical
            a.runModal()
            NSApp.terminate(nil)
            return
        }
        if let lock = readLockfile() {
            log("Server ready on port \\(lock.port)")
            port = lock.port
            DispatchQueue.main.async { self.createWindow() }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.waitForLockfile(attempt: attempt + 1)
            }
        }
    }

    func createWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.load(URLRequest(url: URL(string: "http://localhost:\\(self.port)")!))

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Paneful"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        log("Window created")
    }

    func setupMenuBar() {
        let mainMenu = NSMenu()

        // App menu
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Paneful", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Paneful", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let ho = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        ho.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Paneful", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appItem = NSMenuItem(); appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // Edit menu (enables Cmd+C/V/X/A in WebView)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem(); editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // View menu
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        let viewItem = NSMenuItem(); viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // Window menu
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let windowItem = NSMenuItem(); windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    @objc func reloadPage(_ sender: Any?) {
        webView?.reload()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        if ownedServer, let proc = serverProcess, proc.isRunning {
            log("Terminating server (PID: \\(proc.processIdentifier))")
            proc.terminate()
            proc.waitUntilExit()
        }
        log("App terminated")
        logHandle?.closeFile()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.activate(ignoringOtherApps: true)
app.run()
`;
}

export async function installApp(appPath?: string): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('paneful --install-app is only supported on macOS.');
    process.exit(1);
  }

  // Check for swiftc
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'pipe' });
  } catch {
    console.error('swiftc not found. Install Xcode Command Line Tools:');
    console.error('  xcode-select --install');
    process.exit(1);
  }

  let resolvedPath = appPath;
  if (!resolvedPath) {
    // Show a folder picker dialog so the user can choose where to install
    try {
      const chosen = execFileSync('osascript', ['-e', `
        set defaultDir to POSIX file "/Applications" as alias
        try
          set chosenFolder to choose folder with prompt "Choose where to install Paneful.app:" default location defaultDir
          return POSIX path of chosenFolder
        on error
          return ""
        end try
      `], { encoding: 'utf-8', timeout: 60_000 }).trim();
      if (!chosen) {
        console.log('Installation cancelled.');
        return;
      }
      resolvedPath = path.join(chosen, 'Paneful.app');
    } catch {
      // Fallback if osascript dialog fails (e.g. no GUI session)
      resolvedPath = DEFAULT_APP_PATH;
    }
  }
  const installDir = path.dirname(resolvedPath);
  console.log(`Creating Paneful.app in ${installDir}...`);

  const contentsDir = path.join(resolvedPath, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');

  try {
    // Create directory structure
    fs.mkdirSync(macosDir, { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });

    // Icon
    const iconDir = findIconDir();
    let hasIcon = false;
    if (iconDir) {
      const icnsPath = buildIcns(iconDir, contentsDir);
      hasIcon = icnsPath !== null;
      if (hasIcon) {
        console.log('  Icon: built .icns from assets');
      } else {
        console.log('  Icon: conversion failed, using generic icon');
      }
    } else {
      console.log('  Icon: assets not found, using generic icon');
    }

    // Info.plist
    fs.writeFileSync(path.join(contentsDir, 'Info.plist'), getInfoPlist(hasIcon));
    console.log('  Info.plist: written');

    // Compile Swift wrapper
    const swiftSource = getSwiftSource();
    const tmpSwift = path.join(os.tmpdir(), 'PanefulApp.swift');
    const binaryPath = path.join(macosDir, 'Paneful');

    fs.writeFileSync(tmpSwift, swiftSource);
    console.log('  Compiling native wrapper...');

    try {
      execFileSync('swiftc', [
        tmpSwift,
        '-o', binaryPath,
        '-framework', 'Cocoa',
        '-framework', 'WebKit',
        '-O',
      ], { stdio: 'pipe', timeout: 60_000 });
    } finally {
      try { fs.unlinkSync(tmpSwift); } catch { /* ok */ }
    }

    console.log('  Binary: compiled');

    // Ad-hoc code sign to avoid Gatekeeper warning
    try {
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', resolvedPath], { stdio: 'pipe' });
      console.log('  Signed: ad-hoc');
    } catch {
      console.log('  Signing: skipped (codesign not available)');
    }

    // Touch the app so Finder picks up changes
    try {
      execFileSync('touch', [resolvedPath], { stdio: 'pipe' });
    } catch { /* ok */ }

    console.log('\nPaneful.app installed successfully!');
    console.log('You can now launch Paneful from your Applications folder or Dock.');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      console.error('\nPermission denied. Try:');
      console.error('  sudo paneful --install-app');
      process.exit(1);
    }
    throw err;
  }
}
