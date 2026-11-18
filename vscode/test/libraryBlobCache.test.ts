import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BlobCache, gitBlobSha } from '../src/library/blobCache';

const bytes = (text: string) => new TextEncoder().encode(text);
const template = (text: string, path = 'forms/sub/A.docx') => ({ path, sha: gitBlobSha(bytes(text)), size: text.length });

describe('template blob cache', () => {
  it("computes git's blob id", () => {
    expect(gitBlobSha(bytes('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('downloads on a miss to a path fixed by repo and path, then serves hits without downloading', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const v1 = template('version one');
    let downloads = 0;
    const download = async () => {
      downloads++;
      return bytes('version one');
    };

    const first = await cache.ensure('acme', 'letters', v1, download);
    expect(first).toEqual({ file: join(root, 'libraries', 'acme', 'letters', 'forms', 'sub', 'A.docx'), downloaded: true });
    expect(readFileSync(first.file, 'utf8')).toBe('version one');

    expect(await new BlobCache(root).ensure('acme', 'letters', v1, download)).toEqual({ file: first.file, downloaded: false });
    expect(downloads).toBe(1);
    expect(await cache.cached('acme', 'letters', v1)).toBe(first.file);
  });

  it('replaces a stale copy in place when the listed blob changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const first = await cache.ensure('acme', 'letters', template('version one'), async () => bytes('version one'));
    const v2 = template('version two');
    expect(await cache.cached('acme', 'letters', v2)).toBeUndefined();
    const second = await cache.ensure('acme', 'letters', v2, async () => bytes('version two'));
    expect(second).toEqual({ file: first.file, downloaded: true });
    expect(readFileSync(second.file, 'utf8')).toBe('version two');
    expect(readdirSync(dirname(second.file))).toEqual(['A.docx']);
  });

  it('downloads again when the cached file has gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const v1 = template('version one');
    const { file } = await cache.ensure('acme', 'letters', v1, async () => bytes('version one'));
    rmSync(file);
    expect(await cache.cached('acme', 'letters', v1)).toBeUndefined();
    expect((await cache.ensure('acme', 'letters', v1, async () => bytes('version one'))).file).toBe(file);
  });

  it("rejects a download that doesn't match the listed blob and keeps the old copy", async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const { file } = await cache.ensure('acme', 'letters', template('version one'), async () => bytes('version one'));
    await expect(cache.ensure('acme', 'letters', template('version two'), async () => bytes('truncated'))).rejects.toThrow(/doesn't match/);
    expect(readFileSync(file, 'utf8')).toBe('version one');
  });

  it('records several downloads in the manifest at once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const names = Array.from({ length: 10 }, (_, i) => `T${i}.docx`);
    await Promise.all(names.map((name) => cache.ensure('acme', 'letters', template(name, name), async () => bytes(name))));
    const manifest = JSON.parse(readFileSync(join(root, 'library-manifests', 'acme', 'letters.json'), 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(names.sort());
  });

  it('refuses a path that leaves the repo folder', () => {
    expect(() => new BlobCache('/store').file('acme', 'letters', '../../x.docx')).toThrow(/Refusing/);
  });
});
