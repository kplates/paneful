import { execFile } from 'node:child_process';
import fs from 'node:fs';

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
