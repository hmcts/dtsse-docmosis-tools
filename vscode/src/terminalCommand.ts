import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const SETTING_SECTION = 'hmctsTemplatePreview';
export const SETTING_KEY = 'terminalCommand';

/** Puts the bundled docmosis command on the PATH of new integrated terminals, or takes it off. */
export function applyTerminalCommand(context: vscode.ExtensionContext): void {
  const collection = context.environmentVariableCollection;
  collection.clear();
  const enabled = vscode.workspace.getConfiguration(SETTING_SECTION).get<boolean>(SETTING_KEY, true);
  if (!enabled) return;

  const dir = path.join(context.extensionPath, 'dist', 'cli');
  collection.description = 'HMCTS Template Preview: adds the docmosis command';
  collection.prepend('PATH', dir + path.delimiter);
  collection.replace('DOCMOSIS_VSCODE_NODE', process.execPath);
  makeExecutable(path.join(dir, 'docmosis'));
}

/** vsce can drop the executable bit when it zips the extension. */
function makeExecutable(file: string): void {
  if (process.platform === 'win32') return;
  fs.chmod(file, 0o755, () => undefined);
}

export function watchTerminalCommand(context: vscode.ExtensionContext): vscode.Disposable {
  applyTerminalCommand(context);
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SETTING_SECTION}.${SETTING_KEY}`)) applyTerminalCommand(context);
  });
}
