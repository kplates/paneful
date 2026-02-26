# Paneful

A browser-based terminal multiplexer. Tmux-style pane management, project workspaces, and a CLI that spawns into a running instance. Ships as a single binary.

## Quick Start

```bash
# Build
make build

# Run
./target/release/paneful

# Or install globally
make install
paneful
```

## Usage

### Start the server

```bash
paneful              # Start server and open browser
paneful --port 8080  # Use a specific port
```

### Spawn projects from anywhere

```bash
cd ~/my-project
paneful --spawn      # Adds project to running instance
```

### Manage projects

```bash
paneful --list              # List all projects
paneful --kill my-project   # Kill a project by name
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New pane (vertical split) |
| `Cmd+Shift+N` | New pane (horizontal split) |
| `Cmd+W` | Close focused pane |
| `Cmd+1-9` | Focus pane by index |
| `Cmd+Arrow` | Move focus to adjacent pane |
| `Cmd+Shift+Arrow` | Swap focused pane with adjacent |
| `Cmd+D` | Toggle sidebar |
| `Cmd+T` | Cycle through layout presets |

## Layout Presets

- **Columns** — side by side, equal widths
- **Rows** — stacked, equal heights
- **Main + Stack** — 60% left, rest stacked right
- **Main + Row** — 60% top, rest side by side bottom
- **Grid** — approximate square grid

## Development

```bash
# Start Vite dev server + Rust backend (hot reload for frontend)
make dev
```

In dev mode, the Rust server proxies `/` to `localhost:5173` (Vite) while handling WebSocket and PTY on port 3000.

## Architecture

- **Backend**: Rust (Axum + portable-pty + tokio)
- **Frontend**: React + TypeScript + xterm.js + Zustand + Tailwind CSS
- **Protocol**: JSON over a single WebSocket connection
- **Distribution**: Single binary with embedded frontend (rust-embed)

## Requirements

- Rust 1.70+
- Node.js 18+ / pnpm
- macOS or Linux
