declare global {
  interface Window {
    __panefulDropPaths?: string[] | null;
  }
}

/**
 * Consume native drop paths if the Swift wrapper injected them.
 * Returns the array of absolute paths, or null if running in a plain browser.
 */
export function consumeNativeDropPaths(): string[] | null {
  const paths = window.__panefulDropPaths;
  if (Array.isArray(paths) && paths.length > 0) {
    window.__panefulDropPaths = null;
    return paths;
  }
  return null;
}

/** Shell-escape a file path for safe pasting into a terminal. */
export function escapeShellPath(p: string): string {
  return /[ ()'"]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p;
}

/**
 * Extract absolute file paths from a drop DataTransfer.
 * Checks (in order): codefiles (VS Code JSON), text/uri-list (file:// URIs),
 * text/plain (raw absolute paths or file:// URIs).
 * Returns empty array if nothing usable was found.
 */
export function extractDropPaths(dt: DataTransfer): string[] {
  // 1. VS Code internal: JSON array of absolute paths
  const codefiles = dt.getData('codefiles');
  if (codefiles) {
    try {
      const parsed = JSON.parse(codefiles);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* ignore */ }
  }

  // 2. Standard URI list (VS Code, Finder, other editors)
  const uriList = dt.getData('text/uri-list').trim();
  if (uriList) {
    const paths = parseFileUris(uriList);
    if (paths.length > 0) return paths;
  }

  // 3. Plain text — raw paths or file:// URIs
  const plain = dt.getData('text/plain').trim();
  if (plain) {
    const paths = parseFileUris(plain);
    if (paths.length > 0) return paths;
    // Raw absolute paths (one per line)
    if (plain.startsWith('/')) {
      const raw = plain.split('\n').map((p) => p.trim()).filter(Boolean);
      if (raw.length > 0) return raw;
    }
  }

  return [];
}

/** Parse file:// URIs from a newline-separated string into absolute paths. */
function parseFileUris(text: string): string[] {
  return text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('file://'))
    .map((uri) => {
      try { return decodeURIComponent(new URL(uri).pathname); }
      catch { return null; }
    })
    .filter((p): p is string => p !== null && p.length > 0);
}
