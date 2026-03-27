import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeInbox(payload: Record<string, unknown>): void {
  const dir = path.join(os.homedir(), '.paneful');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'inbox.json'), JSON.stringify(payload));
}

function sendFiles(files: string[]): void {
  if (files.length === 0) {
    vscode.window.showWarningMessage('No files to send to Paneful');
    return;
  }
  writeInbox({ action: 'paste', files });
  vscode.window.showInformationMessage(`Sent ${files.length} file path${files.length === 1 ? '' : 's'} to Paneful`);
}

export function activate(context: vscode.ExtensionContext) {
  // Send all open editor file paths
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
    sendFiles(files);
  });

  // Send the current active editor's file path
  const sendCurrentFile = vscode.commands.registerCommand('paneful.sendCurrentFile', () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      vscode.window.showWarningMessage('No active file to send to Paneful');
      return;
    }
    sendFiles([uri.fsPath]);
  });

  // Send a file or folder path (from explorer context menu)
  const sendPath = vscode.commands.registerCommand('paneful.sendPath', (uri?: vscode.Uri) => {
    if (!uri) {
      vscode.window.showWarningMessage('No path to send to Paneful');
      return;
    }
    const fsPath = uri.fsPath;
    const isDir = fs.statSync(fsPath, { throwIfNoEntry: false })?.isDirectory();
    writeInbox({ action: 'paste', files: [fsPath] });
    vscode.window.showInformationMessage(`Sent ${isDir ? 'folder' : 'file'} path to Paneful`);
  });

  // Send selected text with file path and line numbers
  const sendSelection = vscode.commands.registerCommand('paneful.sendSelection', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showWarningMessage('No selection to send to Paneful');
      return;
    }
    const text = editor.document.getText(editor.selection);
    const uri = editor.document.uri;
    const startLine = editor.selection.start.line + 1;
    const endLine = editor.selection.end.line + 1;
    const filePath = uri.scheme === 'file' ? uri.fsPath : undefined;
    const lineRange = startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;

    writeInbox({
      action: 'paste',
      files: filePath ? [`${filePath}:${lineRange}`] : [],
      text,
    });

    vscode.window.showInformationMessage(`Sent selection (${lineRange}) to Paneful`);
  });

  // Spawn a project for the current workspace folder
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

  context.subscriptions.push(sendOpenFiles, sendCurrentFile, sendSelection, sendPath, spawnProject);
}

export function deactivate() {}
