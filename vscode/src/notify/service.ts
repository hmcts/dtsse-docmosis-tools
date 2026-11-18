import type { NotifyTemplate } from '@hmcts-cft/docmosis-tools/notify';
import { mergeProducts, type NotifyProduct } from '@hmcts-cft/docmosis-tools/notify/products';
import { KeyStore, NotifyClient } from '@hmcts-cft/docmosis-tools/notify/node';
import * as vscode from 'vscode';

/** The built-in products with the `hmctsTemplatePreview.notify.products` setting's entries merged in. */
export const configuredProducts = (): NotifyProduct[] =>
  mergeProducts(vscode.workspace.getConfiguration('hmctsTemplatePreview').get<unknown>('notify.products', []));

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
    private readonly createClient: (key: string) => NotifyClient = (key) => new NotifyClient(key),
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
