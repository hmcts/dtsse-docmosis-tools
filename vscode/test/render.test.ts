import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bundledCli, LatestRenderer, RenderAbortedError, renderPdf, renderStem, resolveCli, RenderError } from '../src/render';

describe('resolveCli', () => {
  it('substitutes the workspace folder', () => {
    expect(resolveCli('${workspaceFolder}/bin/docmosis', '/ws')).toBe('/ws/bin/docmosis');
  });
});

describe('bundledCli', () => {
  it('restores the executable bit on the packaged CLI', async () => {
    const ext = await mkdtemp(join(tmpdir(), 'tp-ext-'));
    await mkdir(join(ext, 'cli', 'bin'), { recursive: true });
    const cli = join(ext, 'cli', 'bin', 'docmosis');
    await writeFile(cli, '#!/usr/bin/env bash\n', { mode: 0o644 });
    expect(bundledCli(ext)).toBe(cli);
    expect((await stat(cli)).mode & 0o111).toBe(0o111);
  });
});

async function fakeCli(script: string): Promise<{ cli: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'tp-render-'));
  const cli = join(dir, 'docmosis');
  await writeFile(cli, `#!/usr/bin/env bash\n${script}\n`);
  await chmod(cli, 0o755);
  return { cli, dir };
}

describe('renderPdf', () => {
  it('writes the data, runs `render-file` with --out and returns the PDF path', async () => {
    const { cli, dir } = await fakeCli(
      'echo "$@" > "$(dirname "$0")/args"; while [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done; echo %PDF-fake > "$out"',
    );
    const result = await renderPdf({ cli, docx: join(dir, 'T.docx'), data: { a: 1 }, dev: false, outDir: join(dir, 'out'), cwd: dir });
    expect(await readFile(result.pdfPath, 'utf8')).toContain('%PDF');
    expect(JSON.parse(await readFile(result.dataPath, 'utf8'))).toEqual({ a: 1 });
    const args = (await readFile(join(dir, 'args'), 'utf8')).trim().split(' ');
    expect(args.slice(0, 2)).toEqual(['render-file', expect.stringMatching(/T\.docx$/)]);
    expect(args).not.toContain('--dev');
  });

  it('adds --dev when asked', async () => {
    const { cli, dir } = await fakeCli(
      'echo "$@" > "$(dirname "$0")/args"; while [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done; : > "$out"',
    );
    await renderPdf({ cli, docx: join(dir, 'T.docx'), data: {}, dev: true, outDir: join(dir, 'out'), cwd: dir });
    expect((await readFile(join(dir, 'args'), 'utf8')).trim().split(' ')).toContain('--dev');
  });

  it('runs the CLI with the inherited environment unchanged', async () => {
    const { cli, dir } = await fakeCli(
      'echo "$DOC_RENDER_URL" > "$(dirname "$0")/url"; while [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done; : > "$out"',
    );
    vi.stubEnv('DOC_RENDER_URL', 'https://doc-render.example');
    try {
      await renderPdf({ cli, docx: join(dir, 'T.docx'), data: {}, dev: false, outDir: join(dir, 'out'), cwd: dir });
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await readFile(join(dir, 'url'), 'utf8')).trim()).toBe('https://doc-render.example');
  });

  it('rejects with the CLI stderr on failure', async () => {
    const { cli, dir } = await fakeCli('echo "render failed (HTTP 500)" >&2; exit 1');
    await expect(
      renderPdf({ cli, docx: join(dir, 'T.docx'), data: {}, dev: false, outDir: join(dir, 'out'), cwd: dir }),
    ).rejects.toThrow('render failed (HTTP 500)');
  });

  it('keeps the files of templates with the same name in different folders apart', async () => {
    const { cli, dir } = await fakeCli(
      'while [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done; echo "%PDF-$(basename "$(dirname "$out")")" > "$out"',
    );
    await mkdir(join(dir, 'Base'));
    await mkdir(join(dir, 'AAT'));
    const outDir = join(dir, 'out');
    const base = await renderPdf({ cli, docx: join(dir, 'Base', 'X.docx'), data: { v: 'base' }, dev: false, outDir, cwd: dir });
    const aat = await renderPdf({ cli, docx: join(dir, 'AAT', 'X.docx'), data: { v: 'aat' }, dev: false, outDir, cwd: dir });
    expect(base.pdfPath).not.toBe(aat.pdfPath);
    expect(base.dataPath).not.toBe(aat.dataPath);
    expect(JSON.parse(await readFile(base.dataPath, 'utf8'))).toEqual({ v: 'base' });
    expect(JSON.parse(await readFile(aat.dataPath, 'utf8'))).toEqual({ v: 'aat' });
    expect(renderStem(join(dir, 'Base', 'X.docx'))).toMatch(/^X-[0-9a-f]{8}$/);
  });

  it('kills the CLI and rejects with RenderAbortedError when aborted', async () => {
    const { cli, dir } = await fakeCli('exec sleep 30');
    const controller = new AbortController();
    const render = renderPdf({ cli, docx: join(dir, 'T.docx'), data: {}, dev: false, outDir: join(dir, 'out'), cwd: dir, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(render).rejects.toThrow(RenderAbortedError);
  });

  it('says so when the CLI is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tp-render-'));
    await expect(
      renderPdf({ cli: join(dir, 'nope'), docx: 'T.docx', data: {}, dev: false, outDir: dir, cwd: dir }),
    ).rejects.toThrow(RenderError);
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
