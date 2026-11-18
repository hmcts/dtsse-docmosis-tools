import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobCache, gitBlobSha, refFolder } from '../src/library/blobCache';
import * as fsutil from '../src/library/fsutil';

vi.mock('../src/library/fsutil', async (original) => {
  const actual = await original<typeof import('../src/library/fsutil')>();
  return { ...actual, readJson: vi.fn(actual.readJson) };
});

const bytes = (text: string) => new TextEncoder().encode(text);
const template = (text: string, path = 'forms/sub/A.docx') => ({ path, sha: gitBlobSha(bytes(text)), size: text.length });
const letters = { owner: 'acme', repo: 'letters', ref: undefined };
const at = (ref: string) => ({ ...letters, ref });

describe('template blob cache', () => {
  beforeEach(() => {
    vi.mocked(fsutil.readJson).mockClear();
  });

  it("computes git's blob id", () => {
    expect(gitBlobSha(bytes('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('downloads on a miss to a path fixed by repo, ref and path, then serves hits without downloading', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const v1 = template('version one');
    let downloads = 0;
    const download = async () => {
      downloads++;
      return bytes('version one');
    };

    const first = await cache.ensure(letters, v1, download);
    expect(first).toEqual({ file: join(root, 'libraries', 'acme', 'letters', 'default', 'forms', 'sub', 'A.docx'), downloaded: true });
    expect(readFileSync(first.file, 'utf8')).toBe('version one');

    expect(await new BlobCache(root).ensure(letters, v1, download)).toEqual({ file: first.file, downloaded: false });
    expect(downloads).toBe(1);
    expect(await cache.cached(letters, v1)).toBe(first.file);
  });

  it('keeps a copy per ref, so two libraries on one repo at different refs keep their own versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const main = await cache.ensure(letters, template('on main'), async () => bytes('on main'));
    const release = await cache.ensure(at('release'), template('on release'), async () => bytes('on release'));
    expect(release.file).not.toBe(main.file);
    expect(readFileSync(main.file, 'utf8')).toBe('on main');
    expect(readFileSync(release.file, 'utf8')).toBe('on release');
    expect(await cache.cached(letters, template('on main'))).toBe(main.file);
    expect(await cache.cached(at('release'), template('on release'))).toBe(release.file);
  });

  it('gives each ref one folder of its own', () => {
    const cache = new BlobCache('/store');
    expect(cache.file(at('a/b'), 'c.docx')).not.toBe(cache.file(at('a'), 'b/c.docx'));
    expect(refFolder('release/2')).not.toContain('/');
    expect(refFolder('release/2')).toBe(refFolder('release/2'));
    expect(refFolder('Main')).not.toBe(refFolder('main'));
    expect(refFolder('a/b')).not.toBe(refFolder('a_b'));
    expect(refFolder('default')).not.toBe(refFolder(undefined));
    expect(refFolder('..')).not.toMatch(/^\.\.?$/);
  });

  it('replaces a stale copy in place when the listed blob changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const first = await cache.ensure(at('release/2'), template('version one'), async () => bytes('version one'));
    const v2 = template('version two');
    expect(await cache.cached(at('release/2'), v2)).toBeUndefined();
    const second = await cache.ensure(at('release/2'), v2, async () => bytes('version two'));
    expect(second).toEqual({ file: first.file, downloaded: true });
    expect(readFileSync(second.file, 'utf8')).toBe('version two');
    expect(readdirSync(dirname(second.file))).toEqual(['A.docx']);
  });

  it('downloads again when the cached file has gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const v1 = template('version one');
    const { file } = await cache.ensure(letters, v1, async () => bytes('version one'));
    rmSync(file);
    expect(await cache.cached(letters, v1)).toBeUndefined();
    expect((await cache.ensure(letters, v1, async () => bytes('version one'))).file).toBe(file);
  });

  it("rejects a download that doesn't match the listed blob and keeps the old copy", async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const { file } = await cache.ensure(letters, template('version one'), async () => bytes('version one'));
    await expect(cache.ensure(letters, template('version two'), async () => bytes('truncated'))).rejects.toThrow(/doesn't match/);
    expect(readFileSync(file, 'utf8')).toBe('version one');
  });

  it('records several downloads in the manifest at once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const names = Array.from({ length: 10 }, (_, i) => `T${i}.docx`);
    await Promise.all(names.map((name) => cache.ensure(letters, template(name, name), async () => bytes(name))));
    const manifest = JSON.parse(readFileSync(join(root, 'library-manifests', 'acme', 'letters', 'default.json'), 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(names.sort());
  });

  it('parses the manifest once while it is unchanged, and again after another window replaces it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-blobs-'));
    const cache = new BlobCache(root);
    const v1 = template('version one');
    await cache.ensure(letters, v1, async () => bytes('version one'));
    vi.mocked(fsutil.readJson).mockClear();

    for (let i = 0; i < 3; i++) expect((await cache.ensure(letters, v1, async () => bytes('never'))).downloaded).toBe(false);
    expect(fsutil.readJson).toHaveBeenCalledTimes(1);

    const manifest = join(root, 'library-manifests', 'acme', 'letters', 'default.json');
    const other = `${manifest}.other`;
    writeFileSync(other, JSON.stringify({ [v1.path]: 'another-blob' }));
    renameSync(other, manifest);
    expect(await cache.cached(letters, v1)).toBeUndefined();
    expect(fsutil.readJson).toHaveBeenCalledTimes(2);
  });

  it('refuses a path that leaves the repo folder', () => {
    expect(() => new BlobCache('/store').file(letters, '../../x.docx')).toThrow(/Refusing/);
  });
});
