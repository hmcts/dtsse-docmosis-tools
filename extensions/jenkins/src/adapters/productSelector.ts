import * as vscode from 'vscode';
import { listProducts, matchView, productForPath, resolveProduct } from '../core/products';
import type { JenkinsService } from './jenkinsService';
import type { CftWorkspace } from './workspace';

const STORE_KEY = 'dtsseJenkins.product';
const ASKED_KEY = 'dtsseJenkins.productSuggestionAsked';

export class ProductSelector implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly item: vscode.StatusBarItem;

  constructor(
    private readonly workspace: CftWorkspace,
    private readonly jenkins: JenkinsService,
    private readonly memento: vscode.Memento,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'dtsseJenkins.selectProduct';
    this.item.tooltip = 'DTSSE Jenkins: select product';
    this.render();
  }

  products() {
    return listProducts(this.workspace.repos, this.workspace.isCloned);
  }

  current(): string | undefined {
    const fallback = vscode.workspace.getConfiguration('dtsseJenkins').get<string>('defaultProduct');
    return resolveProduct(this.products(), [this.memento.get<string>(STORE_KEY), fallback]);
  }

  reposOfCurrent() {
    const name = this.current();
    return this.products().find((product) => product.name === name)?.repos ?? [];
  }

  async select(): Promise<void> {
    const products = this.products();
    const views = await this.jenkins.viewList();
    const overrides =
      vscode.workspace.getConfiguration('dtsseJenkins').get<Record<string, string>>('productViews') ?? {};
    const current = this.current();
    const picked = await vscode.window.showQuickPick(
      products.map((product) => {
        const view = matchView(product.name, views, overrides);
        const bits = [
          view ? `Jenkins view ${view.name}` : 'no Jenkins view',
          `${product.repos.length} repos`,
        ];
        if (product.cloned > 0) bits.push(`${product.cloned} cloned`);
        return {
          label: product.name,
          description: bits.join(' · '),
          picked: product.name === current,
          product: product.name,
        };
      }),
      { title: 'Select product', placeHolder: 'Product whose pipelines to show' },
    );
    if (picked) await this.set(picked.product);
  }

  async set(product: string): Promise<void> {
    await this.memento.update(STORE_KEY, product);
    this.render();
    this.changed.fire();
  }

  /** On first use with nothing chosen, offers the product of the file being edited. */
  async suggestFromEditor(): Promise<void> {
    if (this.current() || this.memento.get<boolean>(ASKED_KEY)) return;
    const fsPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const relative = fsPath ? this.workspace.relativePath(fsPath) : undefined;
    const product = resolveProduct(this.products(), [relative ? productForPath(relative) : undefined]);
    if (!product) return;
    await this.memento.update(ASKED_KEY, true);
    const answer = await vscode.window.showInformationMessage(
      `Use ${product.toUpperCase()} for DTSSE Jenkins?`,
      'Yes',
      'Choose another',
    );
    if (answer === 'Yes') await this.set(product);
    else if (answer === 'Choose another') await this.select();
  }

  render(): void {
    const current = this.current();
    this.item.text = current ? `$(server) ${current.toUpperCase()}` : '$(server) Select product';
    if (this.workspace.root) this.item.show();
    else this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
    this.changed.dispose();
  }
}
