import fs from 'node:fs';
import path from 'node:path';

export interface Settings {
  favourites: Record<string, unknown>;
  ui: {
    theme: string;
    sidebarWidth: number;
    editorSyncEnabled: boolean;
  };
  activeProjectId: string | null;
}

const DEFAULTS: Settings = {
  favourites: {},
  ui: {
    theme: 'system',
    sidebarWidth: 224,
    editorSyncEnabled: true,
  },
  activeProjectId: null,
};

export class SettingsStore {
  private filePath: string;
  private data: Settings;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'settings.json');
    this.data = { ...DEFAULTS, ui: { ...DEFAULTS.ui } };

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.data = {
          favourites: raw.favourites ?? DEFAULTS.favourites,
          ui: {
            theme: raw.ui?.theme ?? DEFAULTS.ui.theme,
            sidebarWidth: raw.ui?.sidebarWidth ?? DEFAULTS.ui.sidebarWidth,
            editorSyncEnabled: raw.ui?.editorSyncEnabled ?? DEFAULTS.ui.editorSyncEnabled,
          },
          activeProjectId: raw.activeProjectId ?? DEFAULTS.activeProjectId,
        };
      } catch {
        // Corrupted file, use defaults
      }
    }
  }

  get(): Settings {
    return this.data;
  }

  update(partial: Partial<Settings>): Settings {
    if (partial.favourites !== undefined) {
      this.data.favourites = partial.favourites;
    }
    if (partial.ui !== undefined) {
      this.data.ui = { ...this.data.ui, ...partial.ui };
    }
    if (partial.activeProjectId !== undefined) {
      this.data.activeProjectId = partial.activeProjectId;
    }
    this.persist();
    return this.data;
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch {
      console.error('Failed to persist settings');
    }
  }
}
