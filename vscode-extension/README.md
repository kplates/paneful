# Paneful for VS Code

Companion extension for [Paneful](https://paneful.dev) — a terminal multiplexer for developers.

## Requirements

[Paneful](https://paneful.dev) must be installed and running. See the [GitHub repo](https://github.com/kplates/paneful) for installation instructions.

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:

- **Paneful: Spawn project** — Creates or activates a Paneful project for the current workspace folder.
- **Paneful: Send open file paths** — Sends the file paths of all open editor tabs to the focused Paneful terminal.
- **Paneful: Send current file path** — Sends the active editor's file path.
- **Paneful: Send selection** — Sends the selected text with file path and line numbers (e.g. `file.ts:L5-L12`).
- **Paneful: Send path** — Sends a file or folder path from the explorer.

## Context Menus

### Editor (right-click in editor)
- Send selection (only when text is selected)
- Send current file path
- Send open file paths

### Explorer (right-click on file or folder)
- Send path (file or folder)
- Send open file paths

## How it works

The extension communicates with the Paneful server via a shared inbox file (`~/.paneful/inbox.json`). Paneful must be running to pick up commands.

## Links

- [Website](https://paneful.dev)
- [GitHub](https://github.com/kplates/paneful)
- [Issues](https://github.com/kplates/paneful/issues)
