import { execFile, execSync } from 'node:child_process';
import fs from 'node:fs';

/** Try to focus an existing Paneful browser window. Returns true if successful. */
export function focusBrowser(_port: number): boolean {
  if (process.platform !== 'darwin') return false;

  // App-mode Chrome windows don't have normal tabs — match by window title instead.
  // The HTML <title> is "Paneful", so any app-mode or regular window showing the app
  // will have "Paneful" in its title.
  const browsers = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser', 'Arc'];

  for (const browser of browsers) {
    const lines = [
      `tell application "System Events"`,
      `  if not (exists process "${browser}") then return false`,
      `end tell`,
      `tell application "${browser}"`,
      `  repeat with w in windows`,
      `    if title of w contains "Paneful" then`,
      `      set index of w to 1`,
      `      activate`,
      `      return true`,
      `    end if`,
      `  end repeat`,
      `  return false`,
      `end tell`,
    ];
    const args = lines.flatMap((l) => ['-e', l]);

    try {
      const result = execSync(`osascript ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
        timeout: 3000,
        encoding: 'utf-8',
      }).trim();
      if (result === 'true') {
        console.log(`Focused existing Paneful window (${browser})`);
        return true;
      }
    } catch {
      // This browser not running or doesn't have the window
    }
  }

  return false;
}

export function openBrowser(port: number): void {
  const url = `http://localhost:${port}`;
  console.log(`Opening browser at ${url}`);

  if (tryChromeAppMode(url)) return;

  // Fallback: open normally
  console.log('No Chromium-based browser found for app mode, falling back to default browser');
  import('open').then(({ default: open }) => {
    open(url).catch((e: Error) => {
      console.warn('Failed to open browser:', e.message);
    });
  });
  console.error(
    "Tip: Install as a PWA (browser menu > 'Install Paneful') for full keyboard shortcut support",
  );
}

function tryChromeAppMode(url: string): boolean {
  const appArg = `--app=${url}`;

  if (process.platform === 'darwin') {
    const browsers = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Arc.app/Contents/MacOS/Arc',
    ];

    for (const browser of browsers) {
      if (fs.existsSync(browser)) {
        execFile(browser, [appArg], (err) => {
          if (err) console.warn(`Failed to launch ${browser}:`, err.message);
        });
        console.log(`Opened in app mode via ${browser}`);
        return true;
      }
    }
  } else if (process.platform === 'linux') {
    const browsers = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'microsoft-edge',
      'brave-browser',
    ];

    for (const browser of browsers) {
      try {
        execFile(browser, [appArg], (err) => {
          if (err) { /* browser not found or failed */ }
        });
        console.log(`Opened in app mode via ${browser}`);
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}
