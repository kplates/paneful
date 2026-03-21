# Changelog

## 0.9.14 — 2026-03-21

- VS Code extension published to the [Marketplace](https://marketplace.visualstudio.com/items?itemName=kplates.paneful-vscode)
  - **Paneful: Spawn project** — create or activate a project for the current workspace
  - **Paneful: Send open file paths** — send open editor tabs to the focused terminal
- Inbox monitor now supports action-based dispatch (spawn, paste) with backwards compatibility
- Updated docs site and README with VS Code extension install instructions

## 0.9.13 — 2026-03-21

- Add changelog link to update banner
- Fix update banner links not opening in native app

## 0.9.12 — 2026-03-21

- Improved editor sync tooltip messaging

## 0.9.11 — 2026-03-21

- Add accessibility permission warning for editor sync — shows a yellow dot on the sync toggle when permission is missing
- Editor sync monitor only runs when sync is enabled (reduces idle resource usage)
- Improved tooltip guidance: directs users to add paneful-editor-helper in Accessibility settings, with re-add/toggle hints for updates
- Native helper binary now supports `--check` flag for lightweight permission probing

## 0.9.10 — 2026-03-21

- Updated docs site with screenshot slider and hover-to-pause
- Added SEO metadata, sitemap, robots.txt, and JSON-LD structured data
- Added llms.txt for AI discoverability
- Updated npm package description and keywords
- Optimized screenshot file sizes

## 0.9.9 — 2026-03-20

- GPU-accelerated terminal rendering via WebGL2 (enabled by default, toggle in sidebar or command palette)
- Instant native drag & drop in macOS app via native pasteboard
- Ctrl/Cmd+Click to open URLs in system browser
- Click to reposition cursor on current input line
- Strip trailing whitespace on terminal copy
- Bar cursor style
- Scroll active project into view on editor sync
- Faster pane focus
- Fix Codex agent detection

## 0.9.8 — 2026-03-19

- Click to move cursor on the current input line
- Open links in browser window
- Fix copy from terminal
- Fix drag & drop from VS Code

## 0.9.7 — 2026-03-17

- Allow wider sidebar
- Show more git details in sidebar
- Small performance clean up

## 0.9.5 — 2026-03-13

- Bump xterm.js dependency
- Fix performance issues with editor sync
- Fix editor focus when moving between files
- Fix light mode across project switches

## 0.9.3 — 2026-03-05

- Patch release

## 0.9.2 — 2026-03-05

- Performance improvements
- Favourites section on empty states
- Better highlight for active project in sidebar

## 0.9.1 — 2026-03-03

- Add terminal search (Cmd+F)
- Add command palette (Cmd+P)
- Show current git branch in sidebar
- Add Codex support
- Add tooltip for dev server icon
- Add Claude activity indicator
- Move sync toast to center of workspace
- Fix Angular port monitoring and server detection

## 0.8.5 — 2026-03-03

- Add port monitoring — detect dev servers running in terminals
- Add toast notification when editor sync executes
- Fix light mode
- Fix zoom controls

## 0.8.2 — 2026-03-01

- Add project website and docs
- Merge native macOS app installer (Paneful.app)

## 0.8.0 — 2026-03-01

- Add native macOS app wrapper (WKWebView)
- Add self-update support (`paneful update`)
- Add website with animated background
- Fix Cmd+Delete keybinding
- Fix zoom in/out/reset in native app
- Fix shell initialization issues
- Fix VS Code syncing
- Fix keyboard shortcuts

## 0.7.1 — 2026-02-28

- Fix performance issue on launch
- Add dark/light mode support
- Improve focus management
- Prevent spawning duplicate projects
- Improve editor sync speed
- Auto-scroll terminal to bottom

## 0.6.0 — 2026-02-27

- Refactor backend to Node.js
- Add drag & drop for files and folders from VS Code and Finder
- Add sidebar drag hint
- Add editor sync focus
- Add terminal autofocus
- Fix drag & drop pane reordering
- Fix editor syncing when not in focus
- Use consistent port assignment

## 0.1.0 — 2026-02-26

- Initial release — terminal multiplexer with React + xterm.js + WebSocket backend
