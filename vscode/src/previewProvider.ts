import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RenderError } from '@hmcts-cft/docmosis-tools';
import * as vscode from 'vscode';
import { isObject, type JsonObject } from './data';
import type { HostToWebview, TemplateInfo, WebviewToHost } from './messages';
import { LatestRenderer, renderPdf } from './render';
import { fieldsForFailure, parseRenderFailures } from './failure';
import { inferSchema, type InstructionRefs, type ObjectSchema } from './schema';
import { ensureSidecarFolder, readTemplateSidecar, sidecarPath, writeSidecar } from './sidecar';
import { CachedTemplateReader } from './templateTree';
import type { InstructionNode } from './tree';
import { renderBlockers } from './validate';

export const VIEW_TYPE = 'hmctsTemplatePreview.docxPreview';

interface RenderRequest {
  id: number;
  data: JsonObject;
  dev: boolean;
}

interface RenderOutput {
  id: number;
  bytes: Uint8Array;
  pdfPath: string;
}

export class PreviewProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const session = new PreviewSession(this.context, this.output, document.uri, panel);
    panel.onDidDispose(() => session.dispose());
  }
}

class PreviewSession {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly docx: string;
  private readonly root: string;
  private readonly dataFile: string;
  private readonly renderer: LatestRenderer<RenderRequest, RenderOutput>;
  private lastPdf: string | undefined;
  private schema: ObjectSchema | undefined;
  private instructions: InstructionRefs[] = [];
  private reloadTimer: NodeJS.Timeout | undefined;
  private readonly reader: CachedTemplateReader;
  private tree: InstructionNode[] | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    uri: vscode.Uri,
    private readonly panel: vscode.WebviewPanel,
  ) {
    this.docx = uri.fsPath;
    this.root = workspaceRootFor(uri);
    this.dataFile = sidecarPath(this.root, this.docx);
    this.reader = new CachedTemplateReader(this.docx);

    const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = this.html(panel.webview, dist);

    this.renderer = new LatestRenderer<RenderRequest, RenderOutput>({
      run: (request, _seq, signal) => this.run(request, signal),
      onStart: (seq) => this.post({ type: 'rendering', seq }),
      onResult: (seq, result) => {
        this.lastPdf = result.pdfPath;
        this.post({ type: 'pdf', seq, request: result.id, bytes: result.bytes });
      },
      onError: (seq, error, request) => {
        this.output.appendLine(`Render ${seq} failed: ${error.message}`);
        this.output.show(true);
        const failures = parseRenderFailures(error instanceof RenderError ? error.lines.join('\n') : error.message);
        this.post({
          type: 'renderError',
          seq,
          request: request.id,
          message: error.message,
          fields: failures.flatMap((failure) =>
            fieldsForFailure(failure, this.instructions, this.schema).map((path) => ({ path, reason: failure.reason })),
          ),
        });
      },
    });

    this.disposables.push(panel.webview.onDidReceiveMessage((m: WebviewToHost) => void this.handleSafely(m)));

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(this.docx), path.basename(this.docx)),
    );
    const changed = () => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.reloadTemplate(), 300);
    };
    this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed));
  }

  dispose(): void {
    clearTimeout(this.reloadTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  private post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }


  /** Reads the template, or returns undefined when it hasn't changed since the last read. */
  private async loadTemplate(force: boolean): Promise<TemplateInfo | undefined> {
    const tree = await this.reader.read();
    if (!force && tree === this.tree) return undefined;
    this.tree = tree;
    const { root, warnings, refs } = inferSchema(tree);
    this.schema = root;
    this.instructions = refs;
    return { name: path.basename(this.docx), schema: root, warnings };
  }

  private async reloadTemplate(): Promise<void> {
    try {
      const template = await this.loadTemplate(false);
      if (template) this.post({ type: 'template', template });
    } catch (error) {
      this.tree = undefined;
      this.post({ type: 'templateError', message: message(error) });
    }
  }

  private async handleSafely(msg: WebviewToHost): Promise<void> {
    try {
      await this.handle(msg);
    } catch (error) {
      this.output.appendLine(`Couldn't handle "${msg.type}": ${message(error)}`);
      void vscode.window.showErrorMessage(`HMCTS Template Preview: ${message(error)}`);
    }
  }

  private async handle(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
        return this.init();
      case 'render':
        void writeSidecar(this.root, this.dataFile, msg.data).catch((e) =>
          this.output.appendLine(`Couldn't save ${this.dataFile}: ${message(e)}`),
        );
        if (this.schema) {
          const issues = renderBlockers(this.schema, msg.data, msg.dev);
          if (issues.length > 0) {
            this.renderer.cancel();
            this.post({ type: 'invalid', request: msg.id, issues });
            return;
          }
        }
        this.renderer.request({ id: msg.id, data: msg.data, dev: msg.dev });
        return;
      case 'cancelRender':
        this.renderer.cancel();
        return;
      case 'loadData':
        return this.loadData();
      case 'saveData':
        return this.saveData(msg.data);
      case 'openPdf':
        return this.openPdf();
    }
  }

  private async init(): Promise<void> {
    let template: TemplateInfo;
    try {
      template = (await this.loadTemplate(true))!;
    } catch (error) {
      this.tree = undefined;
      this.output.appendLine(`Couldn't read ${this.docx}: ${message(error)}`);
      this.post({ type: 'templateError', message: message(error) });
      return;
    }
    let data: JsonObject = {};
    try {
      const saved = await readTemplateSidecar(this.root, this.docx);
      if (saved) {
        data = saved.data;
        if (saved.from !== this.dataFile) {
          this.post({
            type: 'info',
            message: `Loaded data saved by an earlier version from ${path.relative(this.root, saved.from)}; it will be saved to ${path.relative(this.root, this.dataFile)}.`,
          });
        }
      }
    } catch (error) {
      this.post({ type: 'info', message: `Ignored unreadable ${this.dataFile}: ${message(error)}` });
    }
    this.post({
      type: 'init',
      template,
      data,
      dataPath: path.relative(this.root, this.dataFile),
      workerUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdf.worker.min.mjs')).toString(),
      dev: false,
    });
  }

  private async saveData(data: JsonObject): Promise<void> {
    const relative = path.relative(this.root, this.dataFile);
    try {
      await writeSidecar(this.root, this.dataFile, data);
    } catch (error) {
      this.output.appendLine(`Couldn't save ${this.dataFile}: ${message(error)}`);
      this.post({ type: 'info', message: `Couldn't save ${relative}: ${message(error)}` });
      void vscode.window.showErrorMessage(`HMCTS Template Preview: couldn't save ${relative}: ${message(error)}`);
      return;
    }
    this.post({ type: 'info', message: `Saved ${relative}` });
  }

  private async loadData(): Promise<void> {
    const [file] =
      (await vscode.window.showOpenDialog({
        canSelectMany: false,
        defaultUri: vscode.Uri.file(path.dirname(this.dataFile)),
        filters: { JSON: ['json'] },
        openLabel: 'Load data',
      })) ?? [];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await fsp.readFile(file.fsPath, 'utf8'));
      if (!isObject(parsed)) throw new Error('the file must contain a JSON object');
      this.post({ type: 'data', data: parsed });
    } catch (error) {
      this.post({ type: 'info', message: `Couldn't load ${path.basename(file.fsPath)}: ${message(error)}` });
    }
  }

  private async openPdf(): Promise<void> {
    if (!this.lastPdf) {
      this.post({ type: 'info', message: 'Render the template first.' });
      return;
    }
    const target = path.join(path.dirname(this.dataFile), `${path.basename(this.docx, '.docx')}.pdf`);
    await ensureSidecarFolder(this.root, this.dataFile);
    await fsp.copyFile(this.lastPdf, target);
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target));
    this.post({ type: 'info', message: `Saved ${path.relative(this.root, target)}` });
  }

  private async run(request: RenderRequest, signal: AbortSignal): Promise<RenderOutput> {
    const storage = this.context.storageUri ?? this.context.globalStorageUri;
    const outDir = path.join(storage?.fsPath ?? path.join(os.tmpdir(), 'hmcts-template-preview'), 'render');
    const result = await renderPdf({
      docx: this.docx,
      data: request.data,
      dev: request.dev,
      outDir,
      signal,
    });
    return { id: request.id, bytes: result.bytes, pdfPath: result.pdfPath };
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = randomNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      'worker-src blob:',
      `connect-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource} data: blob:`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>HMCTS Template Preview</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function workspaceRootFor(uri: vscode.Uri): string {
  return (
    vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    path.dirname(uri.fsPath)
  );
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
