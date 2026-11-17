import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { el } from './dom';

/** Renders a PDF into a scrolling pane, keeping the reader's page and position across reloads. */
export class PdfPane {
  readonly element: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly placeholder: HTMLElement;
  private doc: PDFDocumentProxy | undefined;
  private generation = 0;

  constructor() {
    this.pages = el('div', { class: 'pdf-pages' });
    this.placeholder = el('div', { class: 'placeholder' }, 'Rendering…');
    this.scroller = el('div', { class: 'pdf-scroll' }, this.placeholder, this.pages);
    this.element = this.scroller;
    new ResizeObserver(() => this.scheduleRelayout()).observe(this.scroller);
  }

  async useWorker(workerUri: string): Promise<void> {
    // Webview resources are cross-origin to the page, so the worker is loaded from a blob.
    const source = await (await fetch(workerUri)).text();
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  }

  setPlaceholder(text: string | undefined): void {
    this.placeholder.textContent = text ?? '';
    this.placeholder.hidden = !text;
  }

  async show(bytes: Uint8Array): Promise<void> {
    const generation = ++this.generation;
    const next = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    if (generation !== this.generation) {
      void next.destroy();
      return;
    }
    const previous = this.doc;
    this.doc = next;
    await this.layout(generation);
    void previous?.destroy();
  }

  private relayoutTimer: number | undefined;

  private scheduleRelayout(): void {
    window.clearTimeout(this.relayoutTimer);
    this.relayoutTimer = window.setTimeout(() => {
      if (this.doc) void this.layout(++this.generation);
    }, 150);
  }

  private async layout(generation: number): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const anchor = this.anchor();
    const width = Math.max(this.scroller.clientWidth - 32, 200);
    const fragment = document.createDocumentFragment();

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (generation !== this.generation) return;
      const base = page.getViewport({ scale: 1 });
      const cssScale = width / base.width;
      const viewport = page.getViewport({ scale: cssScale * window.devicePixelRatio });
      const canvas = el('canvas', { class: 'pdf-page' });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
      canvas.style.height = `${Math.floor(base.height * cssScale)}px`;
      await page.render({ canvas, viewport }).promise;
      if (generation !== this.generation) return;
      fragment.append(canvas);
    }

    this.pages.replaceChildren(fragment);
    this.placeholder.hidden = true;
    this.restore(anchor);
  }

  /** The page at the top of the pane and how far into it the pane is scrolled, as a fraction. */
  private anchor(): { page: number; fraction: number } {
    const top = this.scroller.scrollTop;
    const canvases = Array.from(this.pages.children) as HTMLElement[];
    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i]!;
      if (c.offsetTop + c.offsetHeight > top) {
        return { page: i, fraction: Math.max(0, (top - c.offsetTop) / c.offsetHeight) };
      }
    }
    return { page: 0, fraction: 0 };
  }

  private restore(anchor: { page: number; fraction: number }): void {
    const c = this.pages.children[Math.min(anchor.page, this.pages.children.length - 1)] as HTMLElement | undefined;
    if (c) this.scroller.scrollTop = c.offsetTop + anchor.fraction * c.offsetHeight;
  }
}
