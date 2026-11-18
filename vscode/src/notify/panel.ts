import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { apiPersonalisation, findPlaceholders, templateAdminUrl, type NotifyPreview, type NotifyTemplate } from '@hmcts-cft/docmosis-tools/notify';
import type { NotifyProduct } from '@hmcts-cft/docmosis-tools/notify/products';
import * as vscode from 'vscode';
import { isObject, type JsonObject } from '../data';
import { errorMessage } from '../errorMessage';
import { LatestRenderer } from '../render';
import { webviewHtml } from '../webviewHtml';
import type { Draft, EditorTemplate, EditorToHost, HostToEditor } from './messages';
import type { NotifyService } from './service';
import { NotifyStorage } from './storage';

export const EDITOR_VIEW_TYPE = 'hmctsTemplatePreview.notifyEditor';
export const DIFF_SCHEME = 'hmcts-notify';

/** Read-only documents for `vscode.diff`: the Notify version and the draft of a template. */
export class NotifyDocuments implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  set(uri: vscode.Uri, text: string): void {
    this.contents.set(uri.toString(), text);
    this.changed.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/** One editor panel per template, reused when the template is opened again. */
export class NotifyPanels {
  private readonly sessions = new Map<string, NotifyEditorSession>();
  readonly documents = new NotifyDocuments();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly service: NotifyService,
  ) {}

  open(product: NotifyProduct, template: { id: string; name: string }): void {
    const id = `${product.id}/${template.id}`;
    const existing = this.sessions.get(id);
    if (existing) {
      existing.panel.reveal();
      if (existing.failed) void existing.load();
      return;
    }
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel(EDITOR_VIEW_TYPE, `Notify: ${template.name}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist],
    });
    const session = new NotifyEditorSession(this.context, this.output, this.service, this.documents, product, template.id, panel);
    this.sessions.set(id, session);
    panel.onDidDispose(() => {
      session.dispose();
      this.sessions.delete(id);
    });
  }

  dispose(): void {
    this.documents.dispose();
  }
}

interface PreviewRequest {
  id: number;
  data: JsonObject;
}

interface PreviewOutput {
  id: number;
  preview: NotifyPreview;
  missing: string[];
}

export class NotifyEditorSession {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly storage: NotifyStorage;
  private readonly renderer: LatestRenderer<PreviewRequest, PreviewOutput>;
  private template: NotifyTemplate | undefined;
  private loading: Promise<void> | undefined;
  private loadFailed = false;
  /** The Notify version the saved draft was started from, while there is one. */
  private draftBase: number | undefined;
  /** Draft writes and deletes run one at a time, in the order the webview sent them. */
  private draftQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly service: NotifyService,
    private readonly documents: NotifyDocuments,
    private readonly product: NotifyProduct,
    private readonly templateId: string,
    readonly panel: vscode.WebviewPanel,
  ) {
    this.storage = new NotifyStorage(storageRoot(context), product.id, templateId);

    const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = webviewHtml(panel.webview, dist, {
      title: 'GOV.UK Notify template',
      script: 'notify-editor.js',
      styles: ['webview.css', 'notify.css'],
      // Notify's email HTML is styled inline and may show images from anywhere.
      csp: { 'style-src': `${panel.webview.cspSource} 'unsafe-inline'`, 'img-src': `${panel.webview.cspSource} https: data:` },
    });

    this.renderer = new LatestRenderer<PreviewRequest, PreviewOutput>({
      run: (request, _seq, signal) => this.preview(request, signal),
      onStart: (seq) => this.post({ type: 'previewing', seq }),
      onResult: (seq, result) => this.post({ type: 'preview', seq, request: result.id, preview: content(result.preview), missing: result.missing }),
      onError: (seq, error, request) => {
        this.output.appendLine(`Notify preview ${seq} of ${this.templateId} failed: ${error.message}`);
        this.post({ type: 'previewError', seq, request: request.id, message: error.message });
      },
    });

    this.disposables.push(panel.webview.onDidReceiveMessage((m: EditorToHost) => void this.handleSafely(m)));
  }

  dispose(): void {
    this.renderer.cancel();
    this.disposables.forEach((d) => d.dispose());
  }

  /** True when the template failed to load and hasn't been loaded again since. */
  get failed(): boolean {
    return this.loadFailed && !this.loading;
  }

  /** Loads the template and the saved data and draft, unless a load is already under way. */
  load(): Promise<void> {
    this.loading ??= this.init().finally(() => (this.loading = undefined));
    return this.loading;
  }

  private post(message: HostToEditor): void {
    void this.panel.webview.postMessage(message);
  }

  private async handleSafely(msg: EditorToHost): Promise<void> {
    try {
      await this.handle(msg);
    } catch (error) {
      this.output.appendLine(`Couldn't handle "${msg.type}": ${errorMessage(error)}`);
      void vscode.window.showErrorMessage(`HMCTS Template Preview: ${errorMessage(error)}`);
    }
  }

  private async handle(msg: EditorToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'retry':
        return this.load();
      case 'preview':
        this.renderer.request({ id: msg.id, data: msg.data });
        return;
      case 'cancelPreview':
        this.renderer.cancel();
        return;
      case 'dataChanged':
        return this.storage.writeData(msg.data).catch((e) => this.output.appendLine(`Couldn't save ${this.storage.dataFile}: ${errorMessage(e)}`));
      case 'saveData':
        return this.saveData(msg.data);
      case 'loadData':
        return this.loadData();
      case 'saveDraft':
        return this.queueDraft(() => this.saveDraft(msg.subject, msg.body));
      case 'discardDraft':
        await this.queueDraft(async () => {
          this.draftBase = undefined;
          await this.storage.deleteDraft();
        });
        this.post({ type: 'info', message: "Reverted to Notify's version." });
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(msg.text);
        this.post({ type: 'info', message: `Copied the ${msg.what}. Paste it into the template in Notify.` });
        return;
      case 'showDiff':
        return this.showDiff(msg.subject, msg.body);
      case 'openInNotify': {
        const client = await this.service.client(this.product);
        await vscode.env.openExternal(vscode.Uri.parse(templateAdminUrl(client.serviceId, this.templateId)));
        return;
      }
    }
  }

  private queueDraft(operation: () => Promise<void>): Promise<void> {
    const run = this.draftQueue.then(operation);
    this.draftQueue = run.catch(() => undefined);
    return run;
  }

  private async init(): Promise<void> {
    if (this.loadFailed) this.post({ type: 'loading' });
    try {
      const client = await this.service.client(this.product);
      this.template = await client.getTemplate(this.templateId);
      this.loadFailed = false;
    } catch (error) {
      this.loadFailed = true;
      this.output.appendLine(`Couldn't load Notify template ${this.templateId} for ${this.product.label}: ${errorMessage(error)}`);
      this.post({ type: 'loadError', message: errorMessage(error) });
      return;
    }
    this.panel.title = `Notify: ${this.template.name}`;
    const relative = (file: string) => path.relative(this.storage.root, file);

    let data: JsonObject = {};
    let draft: Draft | undefined;
    try {
      data = (await this.storage.readData()) ?? {};
    } catch (error) {
      this.post({ type: 'info', message: `Ignored unreadable ${relative(this.storage.dataFile)}: ${errorMessage(error)}` });
    }
    try {
      draft = await this.storage.readDraft();
    } catch (error) {
      this.post({ type: 'info', message: `Ignored unreadable ${relative(this.storage.draftFile)}: ${errorMessage(error)}` });
    }
    this.draftBase = draft?.baseVersion;
    this.post({
      type: 'init',
      product: { id: this.product.id, label: this.product.label },
      template: editorTemplate(this.template),
      data,
      dataPath: relative(this.storage.dataFile),
      ...(draft ? { draft } : {}),
      staleDraft: draft !== undefined && draft.baseVersion < this.template.version,
    });
  }

  private async preview(request: PreviewRequest, signal: AbortSignal): Promise<PreviewOutput> {
    if (!this.template) throw new Error('The template has not loaded.');
    const placeholders = findPlaceholders(this.template.subject, this.template.body);
    const { personalisation, missing } = apiPersonalisation(placeholders, request.data);
    const client = await this.service.client(this.product);
    const preview = await client.previewTemplate(this.templateId, personalisation, signal);
    return { id: request.id, preview, missing };
  }

  private async saveDraft(subject: string, body: string): Promise<void> {
    if (!this.template) return;
    const notify = editorTemplate(this.template);
    if (subject === notify.subject && body === notify.body) {
      this.draftBase = undefined;
      await this.storage.deleteDraft();
      return;
    }
    this.draftBase ??= this.template.version;
    await this.storage.writeDraft({ subject, body, baseVersion: this.draftBase });
  }

  private async showDiff(subject: string, body: string): Promise<void> {
    if (!this.template) return;
    const notify = editorTemplate(this.template);
    const folder = `/${this.product.id}/${this.templateId}`;
    const left = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `${folder}/notify-v${notify.version}.md` });
    const right = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `${folder}/draft.md` });
    const text = (s: string, b: string) => (notify.type === 'sms' ? `${b}\n` : `Subject: ${s}\n\n${b}\n`);
    this.documents.set(left, text(notify.subject, notify.body));
    this.documents.set(right, text(subject, body));
    await vscode.commands.executeCommand('vscode.diff', left, right, `${notify.name}: Notify v${notify.version} ↔ draft`);
  }

  private async saveData(data: JsonObject): Promise<void> {
    const relative = path.relative(this.storage.root, this.storage.dataFile);
    try {
      await this.storage.writeData(data);
    } catch (error) {
      this.post({ type: 'info', message: `Couldn't save ${relative}: ${errorMessage(error)}` });
      void vscode.window.showErrorMessage(`HMCTS Template Preview: couldn't save ${relative}: ${errorMessage(error)}`);
      return;
    }
    this.post({ type: 'info', message: `Saved ${relative}` });
  }

  private async loadData(): Promise<void> {
    const [file] =
      (await vscode.window.showOpenDialog({
        canSelectMany: false,
        defaultUri: vscode.Uri.file(path.dirname(this.storage.dataFile)),
        filters: { JSON: ['json'] },
        openLabel: 'Load data',
      })) ?? [];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await fsp.readFile(file.fsPath, 'utf8'));
      if (!isObject(parsed)) throw new Error('the file must contain a JSON object');
      this.post({ type: 'data', data: parsed });
    } catch (error) {
      this.post({ type: 'info', message: `Couldn't load ${path.basename(file.fsPath)}: ${errorMessage(error)}` });
    }
  }
}

function editorTemplate(t: NotifyTemplate): EditorTemplate {
  return { id: t.id, name: t.name, type: t.type, version: t.version, subject: t.subject ?? '', body: t.body ?? '' };
}

function content(p: NotifyPreview): { subject?: string; body: string; html?: string } {
  return { ...(p.subject ? { subject: p.subject } : {}), body: p.body ?? '', ...(p.html ? { html: p.html } : {}) };
}

function storageRoot(context: vscode.ExtensionContext): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath;
}

