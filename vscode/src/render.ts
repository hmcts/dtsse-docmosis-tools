import { spawn } from 'node:child_process';
import { accessSync, chmodSync, constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { JsonObject } from './data';
import { shortHash } from './sidecar';

export function resolveCli(setting: string, workspaceFolder: string): string {
  return setting.replaceAll('${workspaceFolder}', workspaceFolder);
}

/** The CLI packaged inside the extension, at cli/bin/docmosis with its library at cli/lib/docx.mjs. */
export function bundledCli(extensionPath: string): string {
  const cli = path.join(extensionPath, 'cli', 'bin', 'docmosis');
  // A .vsix is a zip, and the executable bit doesn't always survive installation.
  try {
    accessSync(cli, constants.X_OK);
  } catch {
    try {
      chmodSync(cli, 0o755);
    } catch {
      // A missing CLI is reported when it is run.
    }
  }
  return cli;
}

export class RenderError extends Error {}
export class RenderAbortedError extends Error {}

/** The file name stem for a template's render files, unique per template path. */
export function renderStem(docx: string): string {
  return `${path.basename(docx, path.extname(docx))}-${shortHash(docx)}`;
}

export interface RenderOptions {
  cli: string;
  docx: string;
  data: JsonObject;
  dev: boolean;
  /** Folder for the temporary data JSON and the PDF. */
  outDir: string;
  cwd: string;
  log?: (text: string) => void;
  /** Aborting it kills the CLI and rejects with a RenderAbortedError. */
  signal?: AbortSignal;
}

export interface RenderResult {
  pdfPath: string;
  dataPath: string;
}

/** Writes the data to a temp JSON and renders the template through `docmosis render-file`, which sends it to the hosted dtsse-doc-render. */
export async function renderPdf(options: RenderOptions): Promise<RenderResult> {
  const { cli, docx, data, dev, outDir, cwd, log, signal } = options;
  await fs.mkdir(outDir, { recursive: true });
  const stem = renderStem(docx);
  const dataPath = path.join(outDir, `${stem}.data.json`);
  const pdfPath = path.join(outDir, `${stem}.pdf`);
  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
  await fs.rm(pdfPath, { force: true });

  const args = ['render-file', docx, dataPath, '--out', pdfPath, ...(dev ? ['--dev'] : [])];
  log?.(`$ ${cli} ${args.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RenderAbortedError('Render cancelled'));
      return;
    }
    const child = spawn(cli, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => log?.(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      log?.(chunk.toString());
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.name === 'AbortError') {
        reject(new RenderAbortedError('Render cancelled'));
        return;
      }
      reject(
        new RenderError(
          error.code === 'ENOENT'
            ? `The docmosis CLI wasn't found at ${cli}. Clear the hmctsTemplatePreview.docmosisCli setting to use the CLI bundled with the extension, or point it at bin/docmosis in a dtsse-docmosis-tools checkout.`
            : error.message,
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new RenderError(stderr.trim() || `docmosis exited with code ${code}`));
    });
  });

  return { pdfPath, dataPath };
}

export interface LatestRendererHandlers<Request, Result> {
  run(request: Request, seq: number, signal: AbortSignal): Promise<Result>;
  onStart(seq: number): void;
  onResult(seq: number, result: Result): void;
  onError(seq: number, error: Error, request: Request): void;
}

/**
 * Runs one render at a time and keeps only the newest waiting request. Every request gets a
 * sequence number, and a result is delivered only if no newer request or cancel has been made
 * since.
 */
export class LatestRenderer<Request, Result> {
  private seq = 0;
  private running = false;
  private pending: { request: Request; seq: number } | undefined;
  private inFlight: AbortController | undefined;

  constructor(private readonly handlers: LatestRendererHandlers<Request, Result>) {}

  request(request: Request): number {
    const seq = ++this.seq;
    this.pending = { request, seq };
    if (!this.running) void this.drain();
    return seq;
  }

  /** Drops the waiting request and aborts the running one, so neither delivers anything. */
  cancel(): void {
    this.seq++;
    this.pending = undefined;
    this.inFlight?.abort();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const { request, seq } = this.pending;
        this.pending = undefined;
        this.handlers.onStart(seq);
        const controller = new AbortController();
        this.inFlight = controller;
        try {
          const result = await this.handlers.run(request, seq, controller.signal);
          if (seq === this.seq) this.handlers.onResult(seq, result);
        } catch (error) {
          if (seq === this.seq) this.handlers.onError(seq, error instanceof Error ? error : new Error(String(error)), request);
        } finally {
          this.inFlight = undefined;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
