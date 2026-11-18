import * as vscode from 'vscode';
import { watchTerminalCommand } from './terminalCommand';
import { PreviewProvider, VIEW_TYPE } from './previewProvider';
import { TemplateLibraryView } from './library/view';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('HMCTS Template Preview');
  context.subscriptions.push(
    output,
    watchTerminalCommand(context),
    new TemplateLibraryView(context, output),
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new PreviewProvider(context, output), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand('hmctsTemplatePreview.preview', async (resource?: vscode.Uri) => {
      const uri = resource ?? activeDocxUri();
      if (!uri) {
        void vscode.window.showWarningMessage('Select or open a .docx template to preview.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    }),
  );
}

export function deactivate(): void {}

function activeDocxUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri =
    input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : vscode.window.activeTextEditor?.document.uri;
  return uri?.fsPath.toLowerCase().endsWith('.docx') ? uri : undefined;
}
