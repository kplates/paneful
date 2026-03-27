# Changelog

## 0.2.0

- **Paneful: Send selection** — send selected text with file path and line numbers (e.g. `file.ts:L5-L12`). Only appears in the editor context menu when text is selected.
- **Paneful: Send current file path** — send the active editor's file path
- **Paneful: Send path** — send any file or folder path from the explorer
- **Context menus** — right-click in the editor or explorer to send paths to Paneful
  - Editor: "Send selection" (when selected), "Send current file path", "Send open file paths"
  - Explorer: "Send path" (file or folder), "Send open file paths"

## 0.1.0

- Initial release
- **Paneful: Send open file paths** — send all open editor file paths to the focused Paneful terminal
- **Paneful: Spawn project** — create or activate a Paneful project for the current workspace
