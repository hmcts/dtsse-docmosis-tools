import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLibraries } from '../src/library/config';
import { GitHubClient } from '../src/library/github';
import { IndexStore, MIN_CHECK_INTERVAL_MS } from '../src/library/indexStore';
import { blobEntry, fakeFetch, json } from './libraryFakes';

const [library] = parseLibraries([{ repo: 'acme/letters', path: 'forms' }]).libraries;

/** A repo whose HEAD is `head.sha`, answering 304 when asked with the current ETag. */
function repo() {
  const head = { sha: 'c1', files: [blobEntry('forms/A.docx', 'a')] };
  const fetch = fakeFetch({
    '/repos/acme/letters/commits/HEAD': ({ headers }) =>
      headers['if-none-match'] === `"${head.sha}"` ? new Response(null, { status: 304 }) : new Response(head.sha, { headers: { etag: `"${head.sha}"` } }),
    '/repos/acme/letters/git/trees/c1?recursive=1': () => json({ sha: 't1', truncated: false, tree: head.files }),
    '/repos/acme/letters/git/trees/c2?recursive=1': () => json({ sha: 't2', truncated: false, tree: head.files }),
  });
  return { head, fetch, client: new GitHubClient(fetch, 'tok') };
}

const trees = (calls: { url: string }[]) => calls.filter((c) => c.url.includes('/git/trees/')).length;

describe('template index store', () => {
  it('fetches and persists the listing with its commit and ETag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-index-'));
    const { client } = repo();
    const result = await new IndexStore(dir, () => 1000).revalidate(library!, client);
    expect(result).toMatchObject({ checked: true, changed: true });
    const saved = JSON.parse(readFileSync(new IndexStore(dir).file(library!.id), 'utf8'));
    expect(saved).toMatchObject({ version: 1, id: library!.id, commit: 'c1', etag: '"c1"', checkedAt: 1000 });
    expect(saved.templates).toEqual([{ path: 'forms/A.docx', sha: 'a', size: 100 }]);
  });

  it('loads the saved listing in a new session without the network', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-index-'));
    await new IndexStore(dir).revalidate(library!, repo().client);
    const loaded = await new IndexStore(dir).load(library!);
    expect(loaded?.templates.map((t) => t.path)).toEqual(['forms/A.docx']);
  });

  it("doesn't check again inside the minimum interval unless forced", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-index-'));
    let now = 0;
    const store = new IndexStore(dir, () => now);
    const { fetch, client } = repo();
    await store.revalidate(library!, client);
    now = MIN_CHECK_INTERVAL_MS - 1;
    expect(await store.revalidate(library!, client)).toMatchObject({ checked: false, changed: false });
    expect(fetch.calls).toHaveLength(2);
    expect(await store.revalidate(library!, client, { force: true })).toMatchObject({ checked: true, changed: false });
    expect(fetch.calls).toHaveLength(3);
  });

  it('keeps the listing on a 304 and refetches the tree only when the commit moves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-index-'));
    let now = 0;
    const store = new IndexStore(dir, () => now);
    const { head, fetch, client } = repo();
    await store.revalidate(library!, client);
    expect(trees(fetch.calls)).toBe(1);

    now += MIN_CHECK_INTERVAL_MS;
    const unchanged = await store.revalidate(library!, client);
    expect(unchanged).toMatchObject({ checked: true, changed: false });
    expect(unchanged.index.checkedAt).toBe(now);
    expect(trees(fetch.calls)).toBe(1);

    head.sha = 'c2';
    head.files = [blobEntry('forms/A.docx', 'a2'), blobEntry('forms/B.docx', 'b')];
    now += MIN_CHECK_INTERVAL_MS;
    const moved = await store.revalidate(library!, client);
    expect(moved).toMatchObject({ checked: true, changed: true });
    expect(moved.index.commit).toBe('c2');
    expect(moved.index.templates.map((t) => t.sha)).toEqual(['a2', 'b']);
    expect(trees(fetch.calls)).toBe(2);
  });

  it("doesn't refetch the tree when a new ETag names the same commit", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-index-'));
    const store = new IndexStore(dir, () => 0);
    let etag = '"one"';
    const fetch = fakeFetch({
      '/repos/acme/letters/commits/HEAD': () => new Response('c1', { headers: { etag } }),
      '/repos/acme/letters/git/trees/c1?recursive=1': () => json({ sha: 't1', truncated: false, tree: [] }),
    });
    const client = new GitHubClient(fetch, 'tok');
    await store.revalidate(library!, client);
    etag = '"two"';
    const result = await store.revalidate(library!, client, { force: true });
    expect(result.changed).toBe(false);
    expect(result.index.etag).toBe('"two"');
    expect(trees(fetch.calls)).toBe(1);
  });

  it('shares one check between concurrent callers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-index-'));
    const store = new IndexStore(dir);
    const { fetch, client } = repo();
    const [a, b] = await Promise.all([store.revalidate(library!, client), store.revalidate(library!, client)]);
    expect(a).toBe(b);
    expect(fetch.calls).toHaveLength(2);
  });

  it('ignores a saved listing for a different library', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-index-'));
    await new IndexStore(dir).revalidate(library!, repo().client);
    const [other] = parseLibraries([{ repo: 'acme/letters', path: 'other' }]).libraries;
    expect(await new IndexStore(dir).load(other!)).toBeUndefined();
  });
});
