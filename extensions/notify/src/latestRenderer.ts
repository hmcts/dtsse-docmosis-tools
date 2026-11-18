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
