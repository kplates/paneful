# Changelog

## 0.9.19 — 2026-05-26

- New **Scheduled Jobs** (beta) — run any shell command on a recurring schedule, with each run as its own interactive terminal
  - New "Schedules" section in the sidebar (BETA), separate from projects so scheduled runs don't pollute your project layouts
  - Schedule editor with When picker (Every N min/hour/day, Daily at HH:MM, Weekly with day toggles, or raw cron expression) — live preview of next-fire time
  - Working directory chosen via the native Finder folder picker (`/api/pick-folder` → AppleScript `choose folder`)
  - Server-owned PTYs: each fire spawns a fresh terminal that runs in the user's `$SHELL` with login + interactive flags so PATH/aliases load correctly (no more `claude: command not found`)
  - Command finishes but the shell stays alive — no more "the terminal died with Exit 1" — drop into an interactive prompt to inspect, retry, or run follow-up commands
  - Run history per schedule with full output capture to disk (`~/.paneful/runs/<runId>.log`, capped at 1MB), survives server restarts
  - Click any past run to open an interactive viewer with the captured log + live streaming for active runs; full keystroke forwarding so you can answer prompts (e.g. Claude's "trust this folder?")
  - **Pause** (SIGSTOP) freezes the process exactly where it is; **Resume** (SIGCONT) continues from that exact state — useful for stepping away mid-task
  - **Terminate** kills the run; **Delete schedule** stops all running PTYs and cleans up
  - Toast notification when a schedule fires; click it to jump straight into the run viewer
  - Server stays alive while any enabled schedule exists (overrides the idle shutdown)
- **Source control** — fixed cross-project artifact where the previously-selected file's name/diff would linger after switching projects (selection is now tagged with its project and ignored when the active project doesn't match)
- **Internal** — extracted shared `terminal-input.ts` so scheduled-run viewers get the same Shift+Enter / Cmd-arrow / copy-trim workarounds as the main project terminals

## 0.9.18 — 2026-05-21

- New **Source Control** panel (toggle with `Cmd+Shift+G` or the branch icon in the toolbar)
  - Resizable right-side panel showing the active project's working changes
  - Branch bar with ahead/behind counts and one-click pull (`--ff-only`) / push
  - Staged Changes / Changes / Untracked / Conflicted groups with hover actions: stage, unstage, discard
  - Multi-select with Cmd-click (toggle) and Shift-click (range) for bulk operations within a group
  - Inline commit message + Commit button, auto-clears on success
  - Stash list — create (with optional message, includes untracked), apply, pop, and drop directly from the panel
  - "Open in default editor" action on every file row and in the diff header (uses the OS file association)
- New **Diff view** designed for actual review work
  - Whole-file context (not just hunks) — every line visible in place
  - Per-line gutter line numbers (old + new), with `+`/`-` markers
  - Red/green backgrounds for removed/added lines (palette-themed for light/dark)
  - Syntax highlighting via Prism for ~25 common languages (TypeScript, Python, Go, Rust, Swift, Java, C/C++/Objective-C, PHP, Ruby, Kotlin, JSON, YAML, TOML, CSS/SCSS, HTML, SQL, Markdown, Bash, and more)
- Powered by `fs.watch` (with a 15s safety poll) for near-instant updates while the panel is open; zero overhead when collapsed
- Documented the local-install one-liner: `npm -g uninstall paneful; npm run build; npm install -g .; paneful --install-app`

## 0.9.17 — 2026-05-19

- Rewrote dev server detection to use OS-level process ownership instead of scanning terminal text — eliminates false positives where Claude Code mentioning `localhost:3000` lit up the badge, and prevents unrelated processes on the same port from being attributed to the wrong project
- Detection now polls `ps` + `lsof` and attributes a listening port to a project only if its owning process descends from one of the project's PTYs

## 0.9.16

- Fix terminal viewport jumping to the top during streaming output from Claude Code and other tools that use cursor repositioning (React-Ink) — the viewport now stays pinned to the bottom when the user is already scrolled down

## 0.9.15 — 2026-03-27

- Fix terminal crash when running vim, nano, or any program that sends DECRQM escape sequences — caused by an esbuild minification bug mangling xterm v6's `const enum` pattern
- Fix Shift+Arrow keys not working inside terminal editors (vim, nano, less) — Paneful now detects the alternate screen buffer and passes keys through to the terminal
- Shift+Arrow pane swapping continues to work in normal shell mode
- Switched build minifier from esbuild to terser

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
