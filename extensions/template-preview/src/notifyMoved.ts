import * as vscode from 'vscode';

const NOTIFIED_KEY = 'notify.movedNoticeShown';
const NEW_EXTENSION = 'hmcts.hmcts-notify';

/**
 * Notify support moved to its own extension. Tells people who used it, once.
 * Use is read from the product the Notify view remembered when a product was first chosen
 * (globalState `notify.product`), or from the products setting the old editor read.
 */
export function noticeNotifyMoved(context: vscode.ExtensionContext): void {
  if (context.globalState.get<boolean>(NOTIFIED_KEY) || vscode.extensions.getExtension(NEW_EXTENSION)) return;
  const setting = vscode.workspace.getConfiguration('hmctsTemplatePreview').inspect('notify.products');
  const configured = setting?.globalValue !== undefined || setting?.workspaceValue !== undefined || setting?.workspaceFolderValue !== undefined;
  if (!configured && context.globalState.get('notify.product') === undefined) return;

  void context.globalState.update(NOTIFIED_KEY, true);
  void vscode.window
    .showInformationMessage('GOV.UK Notify templates moved out of HMCTS Template Preview into their own extension, "GOV.UK Notify Templates".', 'Install')
    .then((choice) => (choice === 'Install' ? vscode.commands.executeCommand('workbench.extensions.installExtension', NEW_EXTENSION) : undefined));
}
