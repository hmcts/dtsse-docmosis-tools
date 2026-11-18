import * as path from 'node:path';
import * as vscode from 'vscode';
import { VIEW_TYPE } from '../previewProvider';
import { SETTING_SECTION } from '../terminalCommand';
import { ghToken, resolveToken, type Token } from './auth';
import { BlobCache } from './blobCache';
import { LIBRARIES_SETTING, parseLibraries, type LibraryConfig } from './config';
import { baseName, FolderMap, formatSize, searchItems, type SearchItem } from './folderMap';
import { GitHubClient, GitHubError, type FetchLike, type Template } from './github';
import { IndexStore, MIN_CHECK_INTERVAL_MS, type LibraryIndex } from './indexStore';

export const TEMPLATES_VIEW = 'hmctsTemplatePreview.templates';
export const COMMANDS = {
  open: 'hmctsTemplatePreview.openLibraryTemplate',
  search: 'hmctsTemplatePreview.searchTemplates',
  refresh: 'hmctsTemplatePreview.refreshTemplates',
  signIn: 'hmctsTemplatePreview.signInToGitHub',
  configure: 'hmctsTemplatePreview.configureTemplateLibraries',
};
const STATE_CONTEXT = 'hmctsTemplatePreview.templates.state';
const GITHUB_SCOPES = ['repo'];

type State = 'noLibraries' | 'signedOut' | 'loading' | 'error' | 'empty' | 'ready';

export type Node =
  | { kind: 'library'; library: LibraryConfig }
  | { kind: 'folder'; library: LibraryConfig; folder: string }
  | { kind: 'template'; library: LibraryConfig; template: Template };

export interface ViewDependencies {
  fetch?: FetchLike;
  ghToken?: () => Promise<string | undefined>;
}

interface Listing {
  index: LibraryIndex;
  map: FolderMap;
}

/** The Templates view: lists the configured libraries' templates and opens them in the preview. */
export class TemplateLibraryView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private readonly store: IndexStore;
  private readonly blobs: BlobCache;
  private readonly listings = new Map<string, Listing>();
  private readonly errors = new Map<string, Error>();
  private readonly failedAt = new Map<string, number>();
  private libraries: LibraryConfig[] = [];
  private configErrors: string[] = [];
  private token: Promise<Token | undefined> | undefined;
  private signedOut = false;
  private loading: Promise<void> | undefined;
  private revalidating: Promise<void> | undefined;
  private started = false;
  private readonly view: vscode.TreeView<Node>;

  constructor(
    context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly deps: ViewDependencies = {},
  ) {
    const storage = context.globalStorageUri.fsPath;
    this.store = new IndexStore(path.join(storage, 'library-index'));
    this.blobs = new BlobCache(storage);
    this.readConfig();
    this.view = vscode.window.createTreeView(TEMPLATES_VIEW, { treeDataProvider: this, showCollapseAll: true });
    this.disposables.push(
      this.view,
      this.view.onDidChangeVisibility((event) => {
        if (event.visible) void this.revalidate(false);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SETTING_SECTION}.${LIBRARIES_SETTING}`)) this.reconfigure();
      }),
      vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id !== 'github') return;
        this.token = undefined;
        if (this.started) void this.revalidate(false, true);
      }),
      vscode.commands.registerCommand(COMMANDS.open, (node?: Node) => (node?.kind === 'template' ? this.open(node.library, node.template) : undefined)),
      vscode.commands.registerCommand(COMMANDS.search, () => this.search()),
      vscode.commands.registerCommand(COMMANDS.refresh, () => this.revalidate(true)),
      vscode.commands.registerCommand(COMMANDS.signIn, () => this.signIn()),
      vscode.commands.registerCommand(COMMANDS.configure, () =>
        vscode.commands.executeCommand('workbench.action.openSettings', `${SETTING_SECTION}.${LIBRARIES_SETTING}`),
      ),
    );
    this.updateState();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      await this.loadCached();
      if (!this.started) {
        this.started = true;
        void this.revalidate(false);
      }
      const shown = this.libraries.filter((library) => this.listings.has(library.id));
      if (shown.length === 0) return [];
      if (this.libraries.length === 1) return this.folderChildren(this.libraries[0]!, '');
      return this.libraries.map((library) => ({ kind: 'library', library }));
    }
    if (node.kind === 'library') return this.folderChildren(node.library, '');
    if (node.kind === 'folder') return this.folderChildren(node.library, node.folder);
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'library') return this.libraryItem(node.library);
    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(baseName(node.folder), vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `${node.library.id}|folder|${node.folder}`;
      item.iconPath = vscode.ThemeIcon.Folder;
      item.resourceUri = vscode.Uri.file(this.blobs.file(node.library.owner, node.library.repo, joinPath(node.library.path, node.folder)));
      item.contextValue = 'templateFolder';
      return item;
    }
    const { library, template } = node;
    const item = new vscode.TreeItem(baseName(template.path), vscode.TreeItemCollapsibleState.None);
    item.id = `${library.id}|template|${template.path}`;
    item.description = formatSize(template.size);
    item.tooltip = tooltip(library, template, this.listings.get(library.id)?.index);
    item.iconPath = vscode.ThemeIcon.File;
    item.resourceUri = vscode.Uri.file(this.blobs.file(library.owner, library.repo, template.path));
    item.contextValue = 'template';
    item.command = { command: COMMANDS.open, title: 'Preview template', arguments: [node] };
    return item;
  }

  private libraryItem(library: LibraryConfig): vscode.TreeItem {
    const listing = this.listings.get(library.id);
    const error = this.errors.get(library.id);
    const item = new vscode.TreeItem(
      library.label,
      listing ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `${library.id}|library`;
    item.iconPath = new vscode.ThemeIcon(error ? 'warning' : 'repo');
    const ref = library.ref ?? 'default branch';
    item.description = error ? error.message : listing ? `${ref} · ${listing.index.templates.length}` : 'Loading...';
    item.tooltip = `${library.owner}/${library.repo}${library.path ? `/${library.path}` : ''} @ ${ref}${
      listing ? ` (${listing.index.commit.slice(0, 7)})` : ''
    }${error ? `\n${error.message}` : ''}`;
    item.contextValue = 'templateLibrary';
    return item;
  }

  private folderChildren(library: LibraryConfig, folder: string): Node[] {
    const listing = this.listings.get(library.id);
    if (!listing) return [];
    const { folders, files } = listing.map.children(folder);
    return [
      ...folders.map((child): Node => ({ kind: 'folder', library, folder: child })),
      ...files.map((template): Node => ({ kind: 'template', library, template })),
    ];
  }

  private readConfig(): void {
    const parsed = parseLibraries(vscode.workspace.getConfiguration(SETTING_SECTION).get<unknown>(LIBRARIES_SETTING, []));
    this.libraries = parsed.libraries;
    this.configErrors = parsed.errors;
    for (const error of parsed.errors) this.output.appendLine(`${SETTING_SECTION}.${LIBRARIES_SETTING}: ${error}`);
  }

  private reconfigure(): void {
    this.readConfig();
    const ids = new Set(this.libraries.map((library) => library.id));
    for (const id of [...this.listings.keys(), ...this.errors.keys()]) {
      if (!ids.has(id)) {
        this.listings.delete(id);
        this.errors.delete(id);
      }
    }
    this.loading = undefined;
    this.refreshView();
    if (this.started) void this.loadCached().then(() => this.revalidate(false));
  }

  /** Reads the persisted listings, without touching the network. */
  private loadCached(): Promise<void> {
    this.loading ??= Promise.all(
      this.libraries
        .filter((library) => !this.listings.has(library.id))
        .map(async (library) => {
          try {
            const index = await this.store.load(library);
            if (index) this.setListing(library, index);
          } catch (error) {
            this.output.appendLine(`Couldn't read the cached list for ${library.label}: ${message(error)}`);
          }
        }),
    ).then(() => this.updateState());
    return this.loading;
  }

  private setListing(library: LibraryConfig, index: LibraryIndex): void {
    const current = this.listings.get(library.id);
    if (current?.index.commit === index.commit && current.index.templates === index.templates) {
      current.index = index;
      return;
    }
    this.listings.set(library.id, { index, map: new FolderMap(index.templates, library.path) });
  }

  private getToken(): Promise<Token | undefined> {
    this.token ??= resolveToken({
      session: async () =>
        (await vscode.authentication.getSession('github', GITHUB_SCOPES, { silent: true }))?.accessToken,
      gh: this.deps.ghToken ?? (() => ghToken()),
    });
    return this.token;
  }

  private async client(): Promise<GitHubClient | undefined> {
    const token = await this.getToken();
    this.signedOut = !token;
    return token ? new GitHubClient(this.deps.fetch ?? ((url, init) => globalThis.fetch(url, init)), token.value) : undefined;
  }

  /**
   * Rechecks every library. `force` skips the minimum interval. Failures raise a notification when
   * the user asked, or when there is no saved list to fall back on.
   */
  private revalidate(force: boolean, sessionsChanged = false): Promise<void> {
    if (this.revalidating && !force && !sessionsChanged) return this.revalidating;
    const run = this.runRevalidation(force, force || sessionsChanged).finally(() => {
      if (this.revalidating === run) this.revalidating = undefined;
    });
    this.revalidating = run;
    return run;
  }

  private async runRevalidation(force: boolean, retryFailed: boolean): Promise<void> {
    if (this.libraries.length === 0) {
      this.updateState();
      return;
    }
    await this.loadCached();
    const due = retryFailed
      ? this.libraries
      : this.libraries.filter((library) => Date.now() - (this.failedAt.get(library.id) ?? 0) >= MIN_CHECK_INTERVAL_MS);
    if (due.length === 0) return;
    this.updateState('loading');
    if (retryFailed && this.signedOut) this.token = undefined;
    const client = await this.client();
    if (!client) {
      this.updateState();
      if (force) void this.offerSignIn('Sign in to GitHub to list the templates.');
      return;
    }
    const failures = new Map<string, Error>();
    const unlisted = new Set(this.libraries.filter((library) => !this.listings.has(library.id)).map((library) => library.id));
    await Promise.all(
      due.map(async (library) => {
        try {
          const result = await this.store.revalidate(library, client, { force });
          this.errors.delete(library.id);
          this.failedAt.delete(library.id);
          this.setListing(library, result.index);
          if (result.changed) this.output.appendLine(`${library.label}: ${result.index.templates.length} templates at ${result.index.commit.slice(0, 7)}`);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          this.errors.set(library.id, failure);
          this.failedAt.set(library.id, Date.now());
          if (force || unlisted.has(library.id)) failures.set(failure.message, failure);
          this.output.appendLine(`${library.label}: ${failure.message}`);
          if (failure instanceof GitHubError && failure.kind === 'unauthorized') {
            this.token = undefined;
            this.signedOut = true;
          }
        }
      }),
    );
    this.refreshView();
    for (const failure of failures.values()) void this.notify(failure);
  }

  private refreshView(): void {
    this.changed.fire(undefined);
    this.updateState();
  }

  private updateState(override?: State): void {
    const hasListing = this.libraries.some((library) => this.listings.has(library.id));
    let state: State;
    if (this.libraries.length === 0) state = 'noLibraries';
    else if (hasListing) state = [...this.listings.values()].some((listing) => listing.index.templates.length > 0) ? 'ready' : 'empty';
    else if (this.signedOut) state = 'signedOut';
    else if (override) state = override;
    else if (this.libraries.every((library) => this.errors.has(library.id))) state = 'error';
    else state = 'loading';
    void vscode.commands.executeCommand('setContext', STATE_CONTEXT, state);

    const notes: string[] = [];
    if (this.configErrors.length > 0) notes.push(`Some template libraries are misconfigured: ${this.configErrors.join('; ')}.`);
    if (hasListing && this.signedOut) notes.push('Showing the saved list. Sign in to GitHub to check for changes.');
    if (this.libraries.length === 1 || !hasListing) {
      notes.push(...new Set(this.libraries.flatMap((library) => this.errors.get(library.id)?.message ?? [])));
    }
    this.view.message = notes.length > 0 ? notes.join(' ') : undefined;
  }

  private async signIn(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession('github', GITHUB_SCOPES, { createIfNone: true });
      this.token = Promise.resolve({ value: session.accessToken, source: 'vscode' });
      this.signedOut = false;
    } catch (error) {
      void vscode.window.showErrorMessage(`HMCTS Template Preview: GitHub sign-in failed: ${message(error)}`);
      return;
    }
    await this.revalidate(true, true);
  }

  private async offerSignIn(text: string): Promise<void> {
    if ((await vscode.window.showInformationMessage(text, 'Sign in to GitHub')) === 'Sign in to GitHub') await this.signIn();
  }

  private async notify(error: Error): Promise<void> {
    const text = `HMCTS Template Preview: ${error.message}`;
    if (error instanceof GitHubError && error.kind === 'sso' && error.ssoUrl) {
      if ((await vscode.window.showErrorMessage(text, 'Authorise')) === 'Authorise') await vscode.env.openExternal(vscode.Uri.parse(error.ssoUrl));
    } else if (error instanceof GitHubError && error.kind === 'unauthorized') {
      if ((await vscode.window.showErrorMessage(text, 'Sign in to GitHub')) === 'Sign in to GitHub') await this.signIn();
    } else {
      void vscode.window.showErrorMessage(text);
    }
  }

  /** Opens the cached copy when it holds the listed blob; otherwise downloads that blob first. */
  async open(library: LibraryConfig, template: Template): Promise<void> {
    try {
      let file = await this.blobs.cached(library.owner, library.repo, template);
      if (!file) {
        const client = await this.client();
        if (!client) {
          void this.offerSignIn(`Sign in to GitHub to download ${baseName(template.path)}.`);
          return;
        }
        file = await vscode.window.withProgress(
          {
            location: this.view.visible ? { viewId: TEMPLATES_VIEW } : vscode.ProgressLocation.Notification,
            title: `Downloading ${baseName(template.path)}`,
          },
          async () =>
            (await this.blobs.ensure(library.owner, library.repo, template, () => client.blob(library.owner, library.repo, template.sha))).file,
        );
      }
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), VIEW_TYPE);
    } catch (error) {
      this.output.appendLine(`Couldn't open ${library.owner}/${library.repo}/${template.path}: ${message(error)}`);
      await this.notify(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async search(): Promise<void> {
    if (this.libraries.length === 0) {
      const choice = await vscode.window.showInformationMessage('No template libraries are configured.', 'Configure');
      if (choice === 'Configure') await vscode.commands.executeCommand(COMMANDS.configure);
      return;
    }
    await this.loadCached();
    const pick = vscode.window.createQuickPick<SearchItem>();
    pick.placeholder = 'Search templates by name or folder';
    pick.matchOnDescription = true;
    const fill = () => {
      pick.items = searchItems(
        this.libraries.flatMap((library) => {
          const listing = this.listings.get(library.id);
          return listing ? [{ library, templates: listing.index.templates }] : [];
        }),
      );
    };
    fill();
    const pending = this.revalidate(false);
    pick.busy = true;
    void pending.finally(() => {
      fill();
      pick.busy = false;
    });
    pick.onDidAccept(() => {
      const [chosen] = pick.selectedItems;
      pick.hide();
      if (chosen) void this.open(chosen.library, chosen.template);
    });
    pick.onDidHide(() => pick.dispose());
    pick.show();
  }
}

const joinPath = (prefix: string, relative: string): string => (prefix && relative ? `${prefix}/${relative}` : prefix || relative);

function tooltip(library: LibraryConfig, template: Template, index: LibraryIndex | undefined): string {
  const ref = library.ref ?? 'default branch';
  const commit = index ? ` (${index.commit.slice(0, 7)})` : '';
  return `${library.owner}/${library.repo}/${template.path}\n${ref}${commit} · ${formatSize(template.size)}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
