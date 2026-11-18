import * as vscode from 'vscode';
import { watchTerminalCommand } from './terminalCommand';
import { DIFF_SCHEME, NotifyPanels } from './notify/panel';
import { NotifyService } from './notify/service';
import { NotifySidebar, PICKER_VIEW_ID } from './notify/sidebar';
import { PreviewProvider, VIEW_TYPE } from './previewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('HMCTS Template Preview');
  context.subscriptions.push(
    output,
    watchTerminalCommand(context),
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
  activateNotify(context, output);
}

function activateNotify(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const service = new NotifyService();
  const panels = new NotifyPanels(context, output, service);
  const sidebar = new NotifySidebar(context, output, service, panels);
  context.subscriptions.push(
    panels,
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, panels.documents),
    vscode.window.registerWebviewViewProvider(PICKER_VIEW_ID, sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('hmctsTemplatePreview.notify.refresh', () => sidebar.refresh()),
    vscode.commands.registerCommand('hmctsTemplatePreview.notify.forgetKey', () => {
      sidebar.forgetKey();
      void vscode.window.showInformationMessage('HMCTS Template Preview: forgot the GOV.UK Notify API keys.');
    }),
    vscode.commands.registerCommand('hmctsTemplatePreview.notify.openTemplate', (product: string, template: string) =>
      sidebar.openTemplate(product, template),
    ),
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
