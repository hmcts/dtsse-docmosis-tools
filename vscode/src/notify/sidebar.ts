import * as vscode from 'vscode';
import { webviewHtml } from '../webviewHtml';
import type { HostToPicker, PickerToHost, TemplateSummary } from './messages';
import type { NotifyPanels } from './panel';
import type { NotifyProduct } from './products';
import type { NotifyService } from './service';

export const PICKER_VIEW_ID = 'hmctsTemplatePreview.notifyTemplates';
const SELECTED_KEY = 'notify.product';

/** The side view: choose a product, then one of its templates to open in an editor panel. */
export class NotifySidebar implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private selected: string | undefined;
  private load = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly service: NotifyService,
    private readonly panels: NotifyPanels,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = webviewHtml(view.webview, dist, {
      title: 'GOV.UK Notify templates',
      script: 'notify-picker.js',
      styles: ['webview.css', 'notify.css'],
      bodyClass: 'picker',
    });
    view.webview.onDidReceiveMessage((m: PickerToHost) => void this.handleSafely(m));
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  /** Reloads the selected product's templates from Notify. */
  refresh(): Promise<void> {
    return this.loadTemplates(true);
  }

  forgetKey(): void {
    this.service.forgetKeys();
    this.post({ type: 'status', message: 'Forgot the Notify API keys; they are read from Key Vault again when next needed.' });
  }

  /** Opens a template in an editor panel, selecting its product in the view. */
  async openTemplate(productId: string, templateId: string): Promise<void> {
    const product = this.requireProduct(productId);
    if (this.selected !== productId) await this.select(productId);
    const templates = await this.service.templates(product);
    const template = templates.find((t) => t.id === templateId);
    this.panels.open(product, { id: templateId, name: template?.name ?? templateId });
  }

  private post(message: HostToPicker): void {
    void this.view?.webview.postMessage(message);
  }

  private async handleSafely(msg: PickerToHost): Promise<void> {
    try {
      await this.handle(msg);
    } catch (error) {
      this.output.appendLine(`Couldn't handle "${msg.type}": ${message(error)}`);
      void vscode.window.showErrorMessage(`HMCTS Template Preview: ${message(error)}`);
    }
  }

  private async handle(msg: PickerToHost): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        const products = this.service.products();
        this.selected ??= this.context.globalState.get<string>(SELECTED_KEY);
        if (this.selected && !products.some((p) => p.id === this.selected)) this.selected = undefined;
        this.post({
          type: 'init',
          products: products.map(({ id, label, vault, secret, note }) => ({ id, label, vault, secret, ...(note ? { note } : {}) })),
          ...(this.selected ? { selected: this.selected } : {}),
        });
        if (this.selected) await this.loadTemplates(false);
        return;
      }
      case 'selectProduct':
        return this.select(msg.product);
      case 'refresh':
        return this.refresh();
      case 'forgetKey':
        return this.forgetKey();
      case 'openTemplate':
        if (!this.selected) return;
        return this.openTemplate(this.selected, msg.template);
    }
  }

  private async select(productId: string): Promise<void> {
    this.requireProduct(productId);
    this.selected = productId;
    await this.context.globalState.update(SELECTED_KEY, productId);
    await this.loadTemplates(false);
  }

  private requireProduct(id: string): NotifyProduct {
    const product = this.service.product(id);
    if (!product) throw new Error(`No Notify product "${id}": check hmctsTemplatePreview.notify.products.`);
    return product;
  }

  private async loadTemplates(refresh: boolean): Promise<void> {
    const product = this.selected ? this.service.product(this.selected) : undefined;
    if (!product) return;
    const load = ++this.load;
    const cached = this.service.keys.has(product.vault, product.secret);
    this.post({
      type: 'loading',
      product: product.id,
      message: cached ? 'Loading templates from GOV.UK Notify…' : `Reading the API key from ${product.vault}…`,
    });
    try {
      const templates = await this.service.templates(product, refresh);
      if (load !== this.load) return;
      const summaries: TemplateSummary[] = templates.map(({ id, name, type }) => ({ id, name, type }));
      const count = `${summaries.length} template${summaries.length === 1 ? '' : 's'}`;
      this.post({
        type: 'templates',
        product: product.id,
        templates: summaries,
        status: `${count}. Key from ${product.vault}/${product.secret}, kept in memory for this session.`,
      });
    } catch (error) {
      if (load !== this.load) return;
      this.output.appendLine(`Couldn't load Notify templates for ${product.label}: ${message(error)}`);
      this.post({ type: 'error', product: product.id, message: message(error) });
    }
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
