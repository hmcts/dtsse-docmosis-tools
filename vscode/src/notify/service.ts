import { NotifyClient, type NotifyTemplate } from './client';
import { KeyStore } from './keyVault';
import { configuredProducts, type NotifyProduct } from './products';

/** Shared by the side view and the editor panels: one key read and one template list per product. */
export class NotifyService {
  private readonly templateLists = new Map<string, Promise<NotifyTemplate[]>>();

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
    const id = `${product.vault}/${product.secret}`;
    let list = refresh ? undefined : this.templateLists.get(id);
    if (!list) {
      list = this.client(product).then((client) => client.listTemplates());
      this.templateLists.set(id, list);
      list.catch(() => {
        if (this.templateLists.get(id) === list) this.templateLists.delete(id);
      });
    }
    return list;
  }

  forgetKeys(): void {
    this.keys.forget();
    this.templateLists.clear();
  }
}
