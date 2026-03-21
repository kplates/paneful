import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeInbox(payload: Record<string, unknown>): void {
  const dir = path.join(os.homedir(), '.paneful');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'inbox.json'), JSON.stringify(payload));
}

export function activate(context: vscode.ExtensionContext) {
  const sendOpenFiles = vscode.commands.registerCommand('paneful.sendOpenFiles', () => {
    const files: string[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input && typeof input === 'object' && 'uri' in input) {
          const uri = (input as { uri: vscode.Uri }).uri;
          if (uri.scheme === 'file') {
            files.push(uri.fsPath);
          }
        }
      }
    }

    if (files.length === 0) {
      vscode.window.showWarningMessage('No open files to send to Paneful');
      return;
    }

    writeInbox({ action: 'paste', files });

    vscode.window.showInformationMessage(`Sent ${files.length} file path${files.length === 1 ? '' : 's'} to Paneful`);
  });

  const spawnProject = vscode.commands.registerCommand('paneful.spawnProject', () => {
    const folder =
      (vscode.window.activeTextEditor &&
        vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) ||
      vscode.workspace.workspaceFolders?.[0];

    if (!folder) {
      vscode.window.showWarningMessage('No workspace folder open');
      return;
    }

    writeInbox({ action: 'spawn', cwd: folder.uri.fsPath, name: folder.name });

    vscode.window.showInformationMessage(`Spawned project: ${folder.name}`);
  });

  context.subscriptions.push(sendOpenFiles, spawnProject);
}

export function deactivate() {}
