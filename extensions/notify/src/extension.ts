import * as vscode from 'vscode';
import { DIFF_SCHEME, NotifyPanels } from './panel';
import { NotifyService } from './service';
import { NotifySidebar, PICKER_VIEW_ID } from './sidebar';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('GOV.UK Notify Templates');
  const service = new NotifyService();
  const panels = new NotifyPanels(context, output, service);
  const sidebar = new NotifySidebar(context, output, service, panels);
  context.subscriptions.push(
    output,
    panels,
    sidebar,
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, panels.documents),
    vscode.window.registerWebviewViewProvider(PICKER_VIEW_ID, sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('hmctsNotify.refresh', () => sidebar.refresh()),
    vscode.commands.registerCommand('hmctsNotify.forgetKey', () => {
      sidebar.forgetKey();
      void vscode.window.showInformationMessage('GOV.UK Notify Templates: forgot the GOV.UK Notify API keys.');
    }),
    vscode.commands.registerCommand('hmctsNotify.openTemplate', (product: string, template: string) =>
      sidebar.openTemplate(product, template),
    ),
  );
}

export function deactivate(): void {}
