import React, { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { X, Loader2, Pause, Play, OctagonX } from "lucide-react";
import { useScheduleStore, isRunActive, subscribeRunOutput } from "../../stores/scheduleStore";
import { useUIStore, getResolvedTheme } from "../../stores/uiStore";
import { sendMessage } from "../../hooks/useWebSocket";
import { registerTerminal, unregisterTerminal } from "../../hooks/useTerminal";
import { XTERM_THEME_DARK, XTERM_THEME_LIGHT } from "../../lib/constants";
import { handleTerminalCoreShortcuts, attachCopyTrim } from "../../lib/terminal-input";
import "@xterm/xterm/css/xterm.css";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function RunLogViewer() {
  const viewingRunId = useScheduleStore((s) => s.viewingRunId);
  const closeLog = useScheduleStore((s) => s.closeLog);
  const runs = useScheduleStore((s) => s.runs);
  const jobs = useScheduleStore((s) => s.jobs);
  const log = useScheduleStore((s) =>
    viewingRunId ? s.runLogs[viewingRunId] : undefined,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenLogRef = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const run = useMemo(
    () => runs.find((r) => r.id === viewingRunId) ?? null,
    [runs, viewingRunId],
  );
  const job = run ? jobs.find((j) => j.id === run.jobId) ?? null : null;
  const active = run ? isRunActive(run) : false;
  const paused = !!run?.paused;

  // Attach on open — the server sends the captured log + (if active) streams live output.
  useEffect(() => {
    if (!viewingRunId) return;
    sendMessage({ type: "schedule:run:attach", runId: viewingRunId });
    return () => {
      sendMessage({ type: "schedule:run:detach", runId: viewingRunId });
    };
  }, [viewingRunId]);

  // Mount xterm whenever the dialog opens. Reset on close so each open is fresh.
  useEffect(() => {
    if (!viewingRunId || !containerRef.current) {
      setMounted(false);
      return;
    }
    const isLight = getResolvedTheme(useUIStore.getState().theme) === "light";
    const term = new Terminal({
      theme: isLight ? XTERM_THEME_LIGHT : XTERM_THEME_DARK,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 10000,
      minimumContrastRatio: isLight ? 7 : 1,
    });
    const fit = new FitAddon();
    const webLinks = new WebLinksAddon((event: MouseEvent, uri: string) => {
      if (event.ctrlKey || event.metaKey) {
        sendMessage({ type: "open:url", url: uri });
      }
    });
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    writtenLogRef.current = null;

    // GPU-accelerated rendering when the user has it enabled.
    let webgl: WebglAddon | null = null;
    if (useUIStore.getState().gpuRendering) {
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl?.dispose();
          webgl = null;
        });
        term.loadAddon(webgl);
      } catch {
        // WebGL2 unavailable — stay on DOM renderer
      }
    }

    // Shared shell-input shortcuts (Shift+Enter, Cmd+Left/Right/Backspace).
    term.attachCustomKeyEventHandler((e) => {
      const sendInput = (data: string) =>
        sendMessage({ type: "schedule:run:input", runId: viewingRunId, data });
      if (handleTerminalCoreShortcuts(e, sendInput)) return false;
      return true;
    });

    // Trim trailing whitespace on copy.
    const detachCopyTrim = attachCopyTrim(term);

    // Register in the global terminal registry so theme/GPU toggles apply uniformly.
    registerTerminal(viewingRunId, term);

    setMounted(true);

    // Send resize on container size changes so the PTY renders correctly.
    const sendResize = () => {
      try {
        fit.fit();
        const cols = term.cols;
        const rows = term.rows;
        if (cols > 0 && rows > 0) {
          sendMessage({ type: "schedule:run:resize", runId: viewingRunId, cols, rows });
        }
      } catch {}
    };
    sendResize();
    const ro = new ResizeObserver(sendResize);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      unregisterTerminal(viewingRunId);
      detachCopyTrim();
      webgl?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setMounted(false);
    };
  }, [viewingRunId]);

  // Once xterm is mounted and we have the initial log, write it once.
  useEffect(() => {
    if (!mounted || !termRef.current || !viewingRunId) return;
    if (log === undefined) return;
    if (writtenLogRef.current === log) return;
    if (writtenLogRef.current === null) {
      termRef.current.clear();
      if (log) termRef.current.write(log);
      writtenLogRef.current = log;
    }
  }, [mounted, log, viewingRunId]);

  // Subscribe to live output (chunks pushed after the initial log).
  useEffect(() => {
    if (!viewingRunId || !mounted) return;
    const unsub = subscribeRunOutput(viewingRunId, (data) => {
      termRef.current?.write(data);
    });
    return unsub;
  }, [viewingRunId, mounted]);

  // Forward user input to the server PTY when the run is active.
  useEffect(() => {
    if (!mounted || !termRef.current || !viewingRunId || !active) return;
    const sub = termRef.current.onData((data) => {
      sendMessage({ type: "schedule:run:input", runId: viewingRunId, data });
    });
    return () => sub.dispose();
  }, [mounted, viewingRunId, active]);

  if (!viewingRunId || !run) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center"
      onClick={closeLog}
    >
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-2xl w-[960px] max-w-[95vw] h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {job?.name ?? "Run"}
            </h3>
            <div className="text-[10px] text-[var(--text-muted)]">
              Started {formatTime(run.startedAt)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge active={active} paused={paused} exitCode={run.exitCode} />
            {active && (paused ? (
              <button
                type="button"
                onClick={() => sendMessage({ type: "schedule:run:resume", runId: viewingRunId })}
                title="Resume (SIGCONT) — process continues from where it was paused"
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-[var(--accent)] hover:bg-[var(--surface-3)]"
              >
                <Play size={11} fill="currentColor" />
                Resume
              </button>
            ) : (
              <button
                type="button"
                onClick={() => sendMessage({ type: "schedule:run:pause", runId: viewingRunId })}
                title="Pause (SIGSTOP) — process freezes in place, resume later"
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-[var(--text-secondary)] hover:bg-[var(--surface-3)]"
              >
                <Pause size={11} fill="currentColor" />
                Pause
              </button>
            ))}
            {active && (
              <button
                type="button"
                onClick={() => sendMessage({ type: "schedule:run:kill", runId: viewingRunId })}
                title="Terminate run (kills the process)"
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-[var(--danger)] hover:bg-[var(--surface-3)]"
              >
                <OctagonX size={11} />
                Terminate
              </button>
            )}
            <button
              type="button"
              onClick={closeLog}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
              title="Close viewer (PTY keeps running in the background)"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-black p-2 overflow-hidden">
          <div ref={containerRef} className="w-full h-full" />
        </div>
        {!active && (
          <div className="px-3 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] text-center">
            This run has ended. The terminal is a read-only replay of the captured output.
          </div>
        )}
        {active && paused && (
          <div className="px-3 py-2 border-t border-[var(--border)] text-[10px] text-yellow-500/80 text-center">
            Paused — the process is frozen in place. Click Resume to continue from exactly where it was.
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  active,
  paused,
  exitCode,
}: {
  active: boolean;
  paused: boolean;
  exitCode: number | null;
}) {
  if (active && paused) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-yellow-500">
        <Pause size={10} fill="currentColor" />
        Paused
      </span>
    );
  }
  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--accent)]">
        <Loader2 size={10} className="animate-spin" />
        Live
      </span>
    );
  }
  if (exitCode === -1) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--danger)]">
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        Terminated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      Closed
    </span>
  );
}
