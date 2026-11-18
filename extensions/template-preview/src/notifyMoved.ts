import * as vscode from 'vscode';

const NOTIFIED_KEY = 'notify.movedNoticeShown';
const NEW_EXTENSION = 'hmcts.hmcts-notify';
const INSTALL = 'Install';
const DISMISS = "Don't show again";

const isSet = (setting: { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined): boolean =>
  setting?.globalValue !== undefined || setting?.workspaceValue !== undefined || setting?.workspaceFolderValue !== undefined;

/**
 * Notify support moved to its own extension. Tells people who used it until they install the new one
 * or ask not to be told again; closing the notice without choosing shows it again next time.
 * Use is read from the product the Notify view remembered when a product was first chosen
 * (globalState `notify.product`), or from the products setting the old editor read.
 */
export function noticeNotifyMoved(context: vscode.ExtensionContext): void {
  if (context.globalState.get<boolean>(NOTIFIED_KEY) || vscode.extensions.getExtension(NEW_EXTENSION)) return;
  const setting = vscode.workspace.getConfiguration('hmctsTemplatePreview').inspect('notify.products');
  if (!isSet(setting) && context.globalState.get('notify.product') === undefined) return;

  void vscode.window
    .showInformationMessage(
      'GOV.UK Notify templates moved out of HMCTS Template Preview into their own extension, "GOV.UK Notify Templates".',
      INSTALL,
      DISMISS,
    )
    .then(async (choice) => {
      if (choice === DISMISS) {
        await context.globalState.update(NOTIFIED_KEY, true);
      } else if (choice === INSTALL) {
        try {
          await vscode.commands.executeCommand('workbench.extensions.installExtension', NEW_EXTENSION);
          await context.globalState.update(NOTIFIED_KEY, true);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Couldn't install "GOV.UK Notify Templates": ${error instanceof Error ? error.message : String(error)}. Install ${NEW_EXTENSION} from the Extensions view.`,
          );
        }
      }
    });
}
