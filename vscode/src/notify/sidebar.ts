import type { NotifyProduct } from '@hmcts-cft/docmosis-tools/notify/products';
import { NOTIFY_URL_ENV, notifyApiOverride } from '@hmcts-cft/docmosis-tools/notify/node';
import * as vscode from 'vscode';
import { errorMessage } from '../errorMessage';
import { webviewHtml } from '../webviewHtml';
import type { HostToPicker, PickerToHost, TemplateSummary } from './messages';
import type { NotifyPanels } from './panel';
import type { NotifyService } from './service';

export const PICKER_VIEW_ID = 'hmctsTemplatePreview.notifyTemplates';
const SELECTED_KEY = 'notify.product';

/** The side view: choose a product, then one of its templates to open in an editor panel. */
export class NotifySidebar implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private selected: string | undefined;
  /** The product whose templates were last loaded, to tell whether a settings change moved its key. */
  private loaded: NotifyProduct | undefined;
  private load = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly service: NotifyService,
    private readonly panels: NotifyPanels,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('hmctsTemplatePreview.notify.products')) void this.productsChanged();
      }),
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

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

  /** Opens a template in an editor panel, selecting its product in the view. The panel fetches the template itself. */
  async openTemplate(productId: string, templateId: string): Promise<void> {
    const product = this.requireProduct(productId);
    if (this.selected !== productId) {
      this.select(productId).catch((e) => this.output.appendLine(`Couldn't select ${productId}: ${errorMessage(e)}`));
    }
    this.panels.open(product, { id: templateId, name: this.service.loadedTemplate(product, templateId)?.name ?? templateId });
  }

  private post(message: HostToPicker): void {
    void this.view?.webview.postMessage(message);
  }

  private async handleSafely(msg: PickerToHost): Promise<void> {
    try {
      await this.handle(msg);
    } catch (error) {
      this.output.appendLine(`Couldn't handle "${msg.type}": ${errorMessage(error)}`);
      void vscode.window.showErrorMessage(`HMCTS Template Preview: ${errorMessage(error)}`);
    }
  }

  private async handle(msg: PickerToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.selected ??= this.context.globalState.get<string>(SELECTED_KEY);
        this.postProducts();
        if (this.selected) await this.loadTemplates(false);
        return;
      case 'selectProduct':
        return this.select(msg.product);
      case 'refresh':
        return this.refresh();
      case 'openTemplate':
        if (!this.selected) return;
        return this.openTemplate(this.selected, msg.template);
    }
  }

  private postProducts(): void {
    const products = this.service.products();
    if (this.selected && !products.some((p) => p.id === this.selected)) this.selected = undefined;
    this.post({
      type: 'init',
      products: products.map(({ id, label, vault, secret, note }) => ({ id, label, vault, secret, ...(note ? { note } : {}) })),
      ...(this.selected ? { selected: this.selected } : {}),
    });
  }

  private async productsChanged(): Promise<void> {
    if (!this.view) return;
    this.postProducts();
    const product = this.selected ? this.service.product(this.selected) : undefined;
    if (product && (product.vault !== this.loaded?.vault || product.secret !== this.loaded?.secret)) await this.loadTemplates(false);
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
    this.loaded = product;
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
      const override = notifyApiOverride();
      this.post({
        type: 'templates',
        product: product.id,
        templates: summaries,
        status: `${count}. Key from ${product.vault}/${product.secret}, kept in memory for this session.${override ? ` Using the Notify API at ${override}, set by ${NOTIFY_URL_ENV}.` : ''}`,
      });
    } catch (error) {
      if (load !== this.load) return;
      this.output.appendLine(`Couldn't load Notify templates for ${product.label}: ${errorMessage(error)}`);
      this.post({ type: 'error', product: product.id, message: errorMessage(error) });
    }
  }
}

