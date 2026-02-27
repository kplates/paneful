import fs from 'node:fs';
import path from 'node:path';

export interface Project {
  id: string;
  name: string;
  cwd: string;
  terminal_ids: string[];
}

export class ProjectStore {
  private projects: Map<string, Project>;
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'projects.json');
    this.projects = new Map();

    if (fs.existsSync(this.filePath)) {
      try {
        const contents = fs.readFileSync(this.filePath, 'utf-8');
        const list: Project[] = JSON.parse(contents);
        for (const p of list) {
          this.projects.set(p.id, p);
        }
      } catch {
        // Corrupted file, start fresh
      }
    }
  }

  create(project: Project): void {
    this.projects.set(project.id, project);
    this.persist();
  }

  remove(projectId: string): Project | undefined {
    const project = this.projects.get(projectId);
    if (project) {
      this.projects.delete(projectId);
      this.persist();
    }
    return project;
  }

  get(projectId: string): Project | undefined {
    return this.projects.get(projectId);
  }

  list(): Project[] {
    return Array.from(this.projects.values());
  }

  findByName(name: string): Project | undefined {
    for (const p of this.projects.values()) {
      if (p.name === name) return p;
    }
    return undefined;
  }

  findByCwd(cwd: string): Project | undefined {
    for (const p of this.projects.values()) {
      if (p.cwd === cwd) return p;
    }
    return undefined;
  }

  addTerminal(projectId: string, terminalId: string): void {
    const project = this.projects.get(projectId);
    if (project && !project.terminal_ids.includes(terminalId)) {
      project.terminal_ids.push(terminalId);
      this.persist();
    }
  }

  removeTerminal(projectId: string, terminalId: string): void {
    const project = this.projects.get(projectId);
    if (project) {
      project.terminal_ids = project.terminal_ids.filter(id => id !== terminalId);
      this.persist();
    }
  }

  getTerminalIds(projectId: string): string[] {
    return this.projects.get(projectId)?.terminal_ids ?? [];
  }

  private persist(): void {
    const list = Array.from(this.projects.values());
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2));
    } catch {
      console.error('Failed to persist projects');
    }
  }
}

export function newProject(id: string, name: string, cwd: string): Project {
  return { id, name, cwd, terminal_ids: [] };
}
