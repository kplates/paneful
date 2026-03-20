import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { sendMessage } from './hooks/useWebSocket';
import { useUIStore } from './stores/uiStore';
import { escapeShellPath } from './lib/native-drop';
import './styles/global.css';
import '@xterm/xterm/css/xterm.css';

// Global handler for Swift native drop — called directly, bypasses slow WKWebView drop processing
window.__panefulHandleDrop = (paths: string[], x?: number, y?: number) => {
  let terminalId = useUIStore.getState().focusedTerminalId;

  // Find the terminal pane under the drop point
  if (x != null && y != null) {
    const el = document.elementFromPoint(x, y)?.closest('[data-terminal-id]');
    if (el) {
      const tid = (el as HTMLElement).dataset.terminalId!;
      terminalId = tid;
      useUIStore.getState().setFocusedTerminal(tid);
    }
  }

  if (terminalId && paths.length > 0) {
    sendMessage({ type: 'pty:input', terminalId, data: paths.map(escapeShellPath).join(' ') });
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
