import { watch, readFileSync, unlinkSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

const INBOX_FILE = 'inbox.json';

export class InboxMonitor {
  private dir: string;
  private onChange: (files: string[]) => void;
  private watcher: FSWatcher | null = null;
  private destroyed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string, onChange: (files: string[]) => void) {
    this.dir = dataDir;
    this.onChange = onChange;
  }

  resume(): void {
    if (this.destroyed || this.watcher) return;

    try {
      this.watcher = watch(this.dir, (event, filename) => {
        if (filename !== INBOX_FILE) return;
        if (event !== 'rename' && event !== 'change') return;
        this.scheduleRead();
      });

      this.watcher.on('error', () => {
        this.stopWatcher();
      });
    } catch {
      // Directory may not exist yet — that's fine
    }
  }

  pause(): void {
    this.stopWatcher();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopWatcher();
  }

  private stopWatcher(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private scheduleRead(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.readAndProcess();
    }, 50);
  }

  private readAndProcess(): void {
    const filePath = join(this.dir, INBOX_FILE);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      // Delete the file immediately after reading
      try { unlinkSync(filePath); } catch {}

      const data = JSON.parse(raw);
      if (data && Array.isArray(data.files) && data.files.length > 0) {
        const files = data.files.filter((f: unknown) => typeof f === 'string');
        if (files.length > 0) {
          this.onChange(files);
        }
      }
    } catch {
      // ENOENT, malformed JSON — ignore
    }
  }
}
