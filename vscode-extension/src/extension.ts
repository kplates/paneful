import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('paneful.sendOpenFiles', () => {
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

    const dir = path.join(os.homedir(), '.paneful');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'inbox.json'), JSON.stringify({ files }));

    vscode.window.showInformationMessage(`Sent ${files.length} file path${files.length === 1 ? '' : 's'} to Paneful`);
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
