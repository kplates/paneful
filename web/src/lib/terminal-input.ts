import type { Terminal } from "@xterm/xterm";

/**
 * Handles key bindings that the shell expects but the browser eats by default.
 * Returns true if the event was consumed (caller should return false from xterm's
 * customKeyEventHandler so the event doesn't propagate further).
 *
 * Bindings:
 *  - Shift+Enter → bracketed-paste-wrapped newline so shells/TUIs insert a
 *    literal newline instead of submitting. Doesn't use Ctrl+V (which would
 *    collide with paste shortcuts in Claude Code and other TUIs — pasting
 *    whatever's on the clipboard, including images).
 *  - Cmd+Left → \x01 (Ctrl+A, line start)
 *  - Cmd+Right → \x05 (Ctrl+E, line end)
 *  - Cmd+Backspace → \x15 (Ctrl+U, clear line)
 */
export function handleTerminalCoreShortcuts(
  e: KeyboardEvent,
  sendInput: (data: string) => void,
): boolean {
  if (e.key === "Enter" && e.shiftKey) {
    if (e.type === "keydown") sendInput("\x1b[200~\n\x1b[201~");
    return true;
  }
  if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.type === "keydown") {
    if (e.key === "ArrowLeft") {
      sendInput("\x01");
      return true;
    }
    if (e.key === "ArrowRight") {
      sendInput("\x05");
      return true;
    }
    if (e.key === "Backspace") {
      sendInput("\x15");
      return true;
    }
  }
  return false;
}

/**
 * Strip trailing whitespace from each line when the user copies. xterm pads each
 * visible row with spaces — without this, copy yields columns of garbage on the right.
 * Returns a cleanup function.
 */
export function attachCopyTrim(term: Terminal): () => void {
  const onCopy = (e: Event) => {
    const sel = term.getSelection();
    if (!sel) return;
    const cleaned = sel.split("\n").map((l) => l.trimEnd()).join("\n");
    (e as ClipboardEvent).clipboardData?.setData("text/plain", cleaned);
    e.preventDefault();
  };
  term.element?.addEventListener("copy", onCopy);
  return () => {
    term.element?.removeEventListener("copy", onCopy);
  };
}
