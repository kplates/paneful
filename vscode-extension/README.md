# Paneful for VS Code

Companion extension for [Paneful](https://paneful.dev) — a terminal multiplexer for developers.

## Requirements

[Paneful](https://paneful.dev) must be installed and running. See the [GitHub repo](https://github.com/kplates/paneful) for installation instructions.

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:

- **Paneful: Spawn project** — Creates or activates a Paneful project for the current workspace folder.
- **Paneful: Send open file paths** — Sends the file paths of all open editor tabs to the focused Paneful terminal. Useful for passing files to CLI tools.

## How it works

The extension communicates with the Paneful server via a shared inbox file (`~/.paneful/inbox.json`). Paneful must be running to pick up commands.

## Links

- [Website](https://paneful.dev)
- [GitHub](https://github.com/kplates/paneful)
- [Issues](https://github.com/kplates/paneful/issues)
