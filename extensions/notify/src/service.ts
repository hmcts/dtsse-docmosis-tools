import type { NotifyTemplate } from '@hmcts-cft/notify-tools';
import { mergeProducts, type NotifyProduct } from '@hmcts-cft/notify-tools/products';
import { KeyStore, NotifyClient } from '@hmcts-cft/notify-tools/node';
import * as vscode from 'vscode';

/** Points the extension at another Notify API, such as a local stand-in. */
export const NOTIFY_URL_ENV = 'HMCTS_NOTIFY_URL';

export const notifyApiOverride = (): string | undefined => process.env[NOTIFY_URL_ENV]?.trim() || undefined;

/** The built-in products with the `hmctsNotify.products` setting's entries merged in. */
export const configuredProducts = (): NotifyProduct[] => mergeProducts(configuredEntries());

/**
 * `hmctsNotify.products`, or the setting this extension replaced when the new one has never been set.
 * The old setting is read at user and workspace level, wherever the HMCTS Template Preview extension kept it.
 */
function configuredEntries(): unknown {
  const current = vscode.workspace.getConfiguration('hmctsNotify').inspect<unknown[]>('products');
  const isSet = current?.globalValue !== undefined || current?.workspaceValue !== undefined || current?.workspaceFolderValue !== undefined;
  const settings = vscode.workspace.getConfiguration(isSet ? 'hmctsNotify' : 'hmctsTemplatePreview');
  return settings.get<unknown>(isSet ? 'products' : 'notify.products', []);
}

const listId = (product: NotifyProduct) => `${product.vault}/${product.secret}`;

/**
 * Shared by the side view and the editor panels: one key read and one template list per product.
 * Panels ask for a client on every request, so forgetting the keys reaches them too.
 */
export class NotifyService {
  private readonly templateLists = new Map<string, Promise<NotifyTemplate[]>>();
  private readonly loadedLists = new Map<string, NotifyTemplate[]>();

  constructor(
    readonly keys = new KeyStore(),
    private readonly createClient: (key: string) => NotifyClient = (key) => new NotifyClient(key, { baseUrl: notifyApiOverride() }),
  ) {}

  products(): NotifyProduct[] {
    return configuredProducts();
  }

  product(id: string): NotifyProduct | undefined {
    return this.products().find((p) => p.id === id);
  }

  async client(product: NotifyProduct): Promise<NotifyClient> {
    return this.createClient(await this.keys.get(product.vault, product.secret));
  }

  templates(product: NotifyProduct, refresh = false): Promise<NotifyTemplate[]> {
    const id = listId(product);
    let list = refresh ? undefined : this.templateLists.get(id);
    if (!list) {
      const loading = this.client(product).then((client) => client.listTemplates());
      list = loading;
      this.templateLists.set(id, loading);
      loading.then(
        (templates) => {
          if (this.templateLists.get(id) === loading) this.loadedLists.set(id, templates);
        },
        () => {
          if (this.templateLists.get(id) === loading) this.templateLists.delete(id);
        },
      );
    }
    return list;
  }

  /** The template from a list already loaded, without waiting for one. */
  loadedTemplate(product: NotifyProduct, templateId: string): NotifyTemplate | undefined {
    return this.loadedLists.get(listId(product))?.find((t) => t.id === templateId);
  }

  forgetKeys(): void {
    this.keys.forget();
    this.templateLists.clear();
    this.loadedLists.clear();
  }
}
