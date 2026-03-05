export const MIN_PANE_RATIO = 0.1;
export const MAX_PANE_RATIO = 0.9;
export const RESIZE_DEBOUNCE_MS = 50;
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

export const SHORTCUTS = {
  NEW_PANE_V: { key: 'n', meta: true, shift: false },
  NEW_PANE_H: { key: 'n', meta: true, shift: true },
  CLOSE_PANE: { key: 'w', meta: true, shift: false },
  TOGGLE_SIDEBAR: { key: 'd', meta: true, shift: false },
  CYCLE_LAYOUT: { key: 't', meta: true, shift: false },
  AUTO_REORGANIZE: { key: 'r', meta: true, shift: false },
  FOCUS_1: { key: '1', meta: true },
  FOCUS_2: { key: '2', meta: true },
  FOCUS_3: { key: '3', meta: true },
  FOCUS_4: { key: '4', meta: true },
  FOCUS_5: { key: '5', meta: true },
  FOCUS_6: { key: '6', meta: true },
  FOCUS_7: { key: '7', meta: true },
  FOCUS_8: { key: '8', meta: true },
  FOCUS_9: { key: '9', meta: true },
} as const;

export const XTERM_THEME_DARK = {
  background: '#0a0a0f',
  foreground: '#ececf1',
  cursor: '#ececf1',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#5b5bd640',
  selectionForeground: '#ececf1',
  black: '#1a1a24',
  red: '#e5484d',
  green: '#30a46c',
  yellow: '#f5d90a',
  blue: '#5b5bd6',
  magenta: '#ab4aba',
  cyan: '#12a594',
  white: '#ececf1',
  brightBlack: '#6b6b80',
  brightRed: '#ff6369',
  brightGreen: '#3dd68c',
  brightYellow: '#ffef5c',
  brightBlue: '#849dff',
  brightMagenta: '#d19dff',
  brightCyan: '#0ac5b3',
  brightWhite: '#ffffff',
};

export const XTERM_THEME_LIGHT = {
  background: '#ffffff',
  foreground: '#1a1a2e',
  cursor: '#1a1a2e',
  cursorAccent: '#ffffff',
  selectionBackground: '#5b5bd630',
  selectionForeground: '#1a1a2e',
  black: '#1a1a2e',
  red: '#dc3545',
  green: '#1a8f5c',
  yellow: '#b58900',
  blue: '#5b5bd6',
  magenta: '#9b3bb0',
  cyan: '#0f8a7e',
  white: '#d0d0d8',
  brightBlack: '#8888a0',
  brightRed: '#e5484d',
  brightGreen: '#30a46c',
  brightYellow: '#d4a017',
  brightBlue: '#6e6ee6',
  brightMagenta: '#ab4aba',
  brightCyan: '#12a594',
  brightWhite: '#d0d0d8',
};
