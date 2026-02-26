# Paneful

A browser-based terminal multiplexer. Tmux-style pane management, project workspaces, and a CLI that spawns into a running instance.

## Install

```bash
npm i -g paneful
```

Or run without installing:

```bash
npx paneful
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

| Shortcut          | Action                          |
| ----------------- | ------------------------------- |
| `Cmd+N`           | New pane (vertical split)       |
| `Cmd+Shift+N`     | New pane (horizontal split)     |
| `Cmd+W`           | Close focused pane              |
| `Cmd+1-9`         | Focus pane by index             |
| `Cmd+Arrow`       | Move focus to adjacent pane     |
| `Cmd+Shift+Arrow` | Swap focused pane with adjacent |
| `Cmd+D`           | Toggle sidebar                  |
| `Cmd+T`           | Cycle through layout presets    |
| `Cmd+R`           | Auto reorganize panes           |

## Layout Presets

- **Columns** — side by side, equal widths
- **Rows** — stacked, equal heights
- **Main + Stack** — 60% left, rest stacked right
- **Main + Row** — 60% top, rest side by side bottom
- **Grid** — approximate square grid

## Development

```bash
npm install && cd web && pnpm install && cd ..

# Dev server (Vite frontend + Node.js backend, hot reload)
npm run dev

# Production build
npm run build

# Run locally
npm start
```

Vite dev server proxies `/ws` and `/api` to `localhost:3000`. Open `http://localhost:5173` or use Chrome in app mode for full keyboard shortcut support:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app=http://localhost:5173
```

## Architecture

- **Backend**: Node.js (Express + node-pty + ws)
- **Frontend**: React + TypeScript + xterm.js + Zustand + Tailwind CSS
- **Protocol**: JSON over a single WebSocket connection
- **Distribution**: npm package (`npx paneful`)

## Requirements

- Node.js 18+
- macOS or Linux
