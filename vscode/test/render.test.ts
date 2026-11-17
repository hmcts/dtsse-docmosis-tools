import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LatestRenderer, RenderAbortedError, RenderError, renderPdf, renderStem } from '../src/render';

const PDF = Buffer.from('%PDF-fake');

/** A fetch that records the request and answers with a PDF, or whatever the handler returns. */
function fakeFetch(handler: (form: FormData) => Response | Promise<Response> = () => new Response(PDF, { headers: { 'content-type': 'application/pdf' } })) {
  const calls: { url: string; form: FormData; signal: AbortSignal | undefined }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const form = init.body as FormData;
    calls.push({ url, form, signal: init.signal ?? undefined });
    return handler(form);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function template(): Promise<{ dir: string; docx: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'tp-render-'));
  const docx = join(dir, 'T.docx');
  await writeFile(docx, 'PK-not-read');
  return { dir, docx };
}

describe('renderPdf', () => {
  it('posts the template and data to the service and writes the PDF', async () => {
    const { dir, docx } = await template();
    const { fetchImpl, calls } = fakeFetch();
    const result = await renderPdf({ docx, data: { a: 1 }, dev: false, outDir: join(dir, 'out'), fetchImpl });
    expect(await readFile(result.pdfPath, 'utf8')).toBe('%PDF-fake');
    expect(Buffer.from(result.bytes).toString()).toBe('%PDF-fake');
    expect(calls[0]!.url).toMatch(/\/api\/render$/);
    expect(JSON.parse(await (calls[0]!.form.get('data') as Blob).text())).toEqual({ a: 1 });
    expect(calls[0]!.form.get('outputFormat')).toBe('pdf');
    expect(calls[0]!.form.get('devMode')).toBe('false');
  });

  it('sets devMode when asked', async () => {
    const { dir, docx } = await template();
    const { fetchImpl, calls } = fakeFetch();
    await renderPdf({ docx, data: {}, dev: true, outDir: join(dir, 'out'), fetchImpl });
    expect(calls[0]!.form.get('devMode')).toBe('true');
  });

  it('sends to DOC_RENDER_URL when it is set', async () => {
    const { dir, docx } = await template();
    const { fetchImpl, calls } = fakeFetch();
    vi.stubEnv('DOC_RENDER_URL', 'https://doc-render.example');
    try {
      await renderPdf({ docx, data: {}, dev: false, outDir: join(dir, 'out'), fetchImpl });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(calls[0]!.url).toBe('https://doc-render.example/api/render');
  });

  it("rejects with the service's error lines when the render fails", async () => {
    const { dir, docx } = await template();
    const body = JSON.stringify({ shortMsg: 'Bad template', longMsg: "Unknown field: <<x>> (word/document.xml, paragraph 2)" });
    const { fetchImpl } = fakeFetch(() => new Response(body, { status: 400, headers: { 'content-type': 'application/json' } }));
    const error = await renderPdf({ docx, data: {}, dev: false, outDir: join(dir, 'out'), fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderError);
    expect((error as RenderError).message).toContain('Render failed (HTTP 400)');
    expect((error as RenderError).lines).toContain('Unknown field: <<x>> (word/document.xml, paragraph 2)');
  });

  it('asks whether the VPN is connected when the service cannot be reached', async () => {
    const { dir, docx } = await template();
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(renderPdf({ docx, data: {}, dev: false, outDir: join(dir, 'out'), fetchImpl })).rejects.toThrow(
      "Can't reach dtsse-doc-render: is the VPN connected?",
    );
  });

  it('keeps the files of templates with the same name in different folders apart', async () => {
    const { dir } = await template();
    await mkdir(join(dir, 'A'));
    await mkdir(join(dir, 'B'));
    await writeFile(join(dir, 'A', 'X.docx'), 'a');
    await writeFile(join(dir, 'B', 'X.docx'), 'b');
    const { fetchImpl } = fakeFetch();
    const outDir = join(dir, 'out');
    const a = await renderPdf({ docx: join(dir, 'A', 'X.docx'), data: {}, dev: false, outDir, fetchImpl });
    const b = await renderPdf({ docx: join(dir, 'B', 'X.docx'), data: {}, dev: false, outDir, fetchImpl });
    expect(a.pdfPath).not.toBe(b.pdfPath);
    expect(renderStem(join(dir, 'A', 'X.docx'))).toMatch(/^X-[0-9a-f]{8}$/);
  });

  it('cancels the request and rejects with RenderAbortedError when aborted', async () => {
    const { dir, docx } = await template();
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const render = renderPdf({ docx, data: {}, dev: false, outDir: join(dir, 'out'), signal: controller.signal, fetchImpl });
    setTimeout(() => controller.abort(), 50);
    await expect(render).rejects.toThrow(RenderAbortedError);
  });

  it('rejects at once when already aborted', async () => {
    const { dir, docx } = await template();
    const controller = new AbortController();
    controller.abort();
    await expect(renderPdf({ docx, data: {}, dev: false, outDir: join(dir, 'out'), signal: controller.signal })).rejects.toThrow(
      RenderAbortedError,
    );
  });
});

describe('LatestRenderer', () => {
  function harness() {
    const events: string[] = [];
    const releases = new Map<number, (value: string) => void>();
    const renderer = new LatestRenderer<string, string>({
      run: (_request, seq) => new Promise((resolve) => releases.set(seq, resolve)),
      onStart: (seq) => events.push(`start ${seq}`),
      onResult: (seq, result) => events.push(`result ${seq} ${result}`),
      onError: (seq, error) => events.push(`error ${seq} ${error.message}`),
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { events, releases, renderer, tick };
  }

  it('delivers a result when nothing newer was requested', async () => {
    const { events, releases, renderer, tick } = harness();
    renderer.request('a');
    await tick();
    releases.get(1)!('A');
    await tick();
    expect(events).toEqual(['start 1', 'result 1 A']);
  });

  it('drops the stale result and runs only the newest waiting request', async () => {
    const { events, releases, renderer, tick } = harness();
    renderer.request('a');
    await tick();
    renderer.request('b');
    renderer.request('c');
    releases.get(1)!('A');
    await tick();
    releases.get(3)!('C');
    await tick();
    expect(events).toEqual(['start 1', 'start 3', 'result 3 C']);
    expect(releases.has(2)).toBe(false);
  });

  it('drops a stale error as well', async () => {
    const events: string[] = [];
    const renderer = new LatestRenderer<string, string>({
      run: async (_r, seq) => {
        if (seq === 1) throw new Error('boom');
        return 'ok';
      },
      onStart: () => undefined,
      onResult: (seq) => events.push(`result ${seq}`),
      onError: (seq) => events.push(`error ${seq}`),
    });
    renderer.request('a');
    renderer.request('b');
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(['result 2']);
  });

  it('cancel drops the running request and the waiting one, and aborts the running one', async () => {
    const events: string[] = [];
    const signals = new Map<number, AbortSignal>();
    const releases = new Map<number, (value: string) => void>();
    const renderer = new LatestRenderer<string, string>({
      run: (_r, seq, signal) => {
        signals.set(seq, signal);
        return new Promise((resolve) => releases.set(seq, resolve));
      },
      onStart: (seq) => events.push(`start ${seq}`),
      onResult: (seq, result) => events.push(`result ${seq} ${result}`),
      onError: (seq, e) => events.push(`error ${seq} ${e.message}`),
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    renderer.request('a');
    await tick();
    renderer.request('b');
    renderer.cancel();
    expect(signals.get(1)?.aborted).toBe(true);
    releases.get(1)!('A');
    await tick();
    expect(events).toEqual(['start 1']);
    expect(releases.has(2)).toBe(false);

    renderer.request('c');
    await tick();
    releases.get(4)!('C');
    await tick();
    expect(events).toEqual(['start 1', 'start 4', 'result 4 C']);
  });

  it('cancel drops an error from the cancelled request', async () => {
    const events: string[] = [];
    const renderer = new LatestRenderer<string, string>({
      run: (_r, _seq, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      onStart: () => undefined,
      onResult: (seq) => events.push(`result ${seq}`),
      onError: (seq, e) => events.push(`error ${seq} ${e.message}`),
    });
    renderer.request('a');
    await new Promise((r) => setTimeout(r, 0));
    renderer.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual([]);
  });

  it('reports an error for the latest request and keeps working afterwards', async () => {
    const events: string[] = [];
    let fail = true;
    const renderer = new LatestRenderer<string, string>({
      run: async () => {
        if (fail) throw new Error('boom');
        return 'ok';
      },
      onStart: () => undefined,
      onResult: (seq) => events.push(`result ${seq}`),
      onError: (seq, e) => events.push(`error ${seq} ${e.message}`),
    });
    renderer.request('a');
    await new Promise((r) => setTimeout(r, 10));
    fail = false;
    renderer.request('b');
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(['error 1 boom', 'result 2']);
  });
});
