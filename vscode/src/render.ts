import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RenderError as ServiceError, renderFile, RenderUnreachable } from '@hmcts-cft/docmosis-tools';
import type { JsonObject } from './data';
import { shortHash } from './sidecar';

/** A render the service refused or that couldn't reach it; `lines` are the service's error lines. */
export class RenderError extends Error {
  constructor(
    message: string,
    readonly lines: string[] = [],
  ) {
    super(message);
  }
}
export class RenderAbortedError extends Error {}

/** The file name stem for a template's render files, unique per template path. */
export function renderStem(docx: string): string {
  return `${path.basename(docx, path.extname(docx))}-${shortHash(docx)}`;
}

export interface RenderOptions {
  docx: string;
  data: JsonObject;
  dev: boolean;
  /** Folder for the PDF. */
  outDir: string;
  /** Aborting it cancels the request and rejects with a RenderAbortedError. */
  signal?: AbortSignal;
  /** Replaces the global fetch, for tests. */
  fetchImpl?: typeof fetch;
}

export interface RenderResult {
  pdfPath: string;
  bytes: Uint8Array;
}

/** Renders the template on the hosted dtsse-doc-render and writes the PDF to the output folder. */
export async function renderPdf(options: RenderOptions): Promise<RenderResult> {
  const { docx, data, dev, outDir, signal } = options;
  if (signal?.aborted) throw new RenderAbortedError('Render cancelled');
  await fs.mkdir(outDir, { recursive: true });
  const pdfPath = path.join(outDir, `${renderStem(docx)}.pdf`);
  const send = options.fetchImpl ?? ((input, init) => fetch(input, init));

  let bytes: Buffer;
  try {
    ({ bytes } = await renderFile({
      template: docx,
      data,
      format: 'pdf',
      devMode: dev,
      signal,
      fetchImpl: send,
    }));
  } catch (error) {
    if (signal?.aborted || (error as Error).name === 'AbortError') throw new RenderAbortedError('Render cancelled');
    if (error instanceof RenderUnreachable) {
      throw new RenderError("Can't reach dtsse-doc-render: is the VPN connected?");
    }
    if (error instanceof ServiceError) {
      const lines = error.lines ?? [];
      throw new RenderError(`Render failed (HTTP ${error.status}):\n${lines.join('\n') || error.shortMsg || error.longMsg}`, lines);
    }
    throw error;
  }
  await fs.writeFile(pdfPath, bytes);
  return { pdfPath, bytes: new Uint8Array(bytes) };
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
