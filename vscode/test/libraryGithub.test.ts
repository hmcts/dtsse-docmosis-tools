import { describe, expect, it } from 'vitest';
import { GitHubClient, GitHubError, isTemplate } from '../src/library/github';
import { blobEntry, fakeFetch, gate, json, treeEntry } from './libraryFakes';

const COMMIT = 'c0ffee0000000000000000000000000000000000';

async function failure(promise: Promise<unknown>): Promise<GitHubError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GitHubError);
  return error as GitHubError;
}

describe('GitHub client', () => {
  it('resolves the default branch to a commit sha with its ETag', async () => {
    const fetch = fakeFetch({
      '/repos/acme/letters/commits/HEAD': () => new Response(`${COMMIT}\n`, { headers: { etag: '"e1"' } }),
    });
    const result = await new GitHubClient(fetch, 'tok').commit('acme', 'letters', undefined);
    expect(result).toEqual({ modified: true, sha: COMMIT, etag: '"e1"' });
    expect(fetch.calls[0]?.headers).toMatchObject({ accept: 'application/vnd.github.sha', authorization: 'Bearer tok' });
    expect(fetch.calls[0]?.headers['if-none-match']).toBeUndefined();
  });

  it('sends the stored ETag and reports a 304 as unmodified', async () => {
    const fetch = fakeFetch({ '/repos/acme/letters/commits/release%2F2': () => new Response(null, { status: 304 }) });
    expect(await new GitHubClient(fetch, 'tok').commit('acme', 'letters', 'release/2', '"e1"')).toEqual({ modified: false });
    expect(fetch.calls[0]?.headers['if-none-match']).toBe('"e1"');
  });

  it('asks for the raw blob', async () => {
    const fetch = fakeFetch({ '/repos/acme/letters/git/blobs/b1': () => new Response(new Uint8Array([1, 2, 3])) });
    expect(await new GitHubClient(fetch, 'tok').blob('acme', 'letters', 'b1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetch.calls[0]?.headers.accept).toBe('application/vnd.github.raw');
  });

  it('maps 401 to signing in again', async () => {
    const fetch = fakeFetch({ '/repos/acme/letters/commits/HEAD': () => new Response('', { status: 401 }) });
    const error = await failure(new GitHubClient(fetch, 'tok').commit('acme', 'letters', undefined));
    expect(error.kind).toBe('unauthorized');
    expect(error.message).toMatch(/sign in to GitHub again/i);
  });

  it('maps an SSO 403 to the authorisation URL', async () => {
    const url = 'https://github.com/orgs/acme/sso?authorization_request=abc';
    const fetch = fakeFetch({
      '/repos/acme/letters/commits/HEAD': () => new Response('', { status: 403, headers: { 'x-github-sso': `required; url=${url}` } }),
    });
    const error = await failure(new GitHubClient(fetch, 'tok').commit('acme', 'letters', undefined));
    expect(error.kind).toBe('sso');
    expect(error.ssoUrl).toBe(url);
    expect(error.message).toContain(url);
  });

  it('maps 404 to a missing or invisible repo', async () => {
    const error = await failure(new GitHubClient(fakeFetch({}), 'tok').commit('acme', 'letters', undefined));
    expect(error.kind).toBe('notFound');
    expect(error.message).toContain('acme/letters');
  });

  it('reports when the rate limit resets', async () => {
    const reset = Math.floor(Date.UTC(2030, 0, 1, 12, 0, 0) / 1000);
    const limited = () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } });
    const error = await failure(new GitHubClient(fakeFetch({ '/repos/acme/letters/commits/HEAD': limited }), 'tok').commit('acme', 'letters', undefined));
    expect(error.kind).toBe('rateLimited');
    expect(error.resetAt?.getTime()).toBe(reset * 1000);
    expect(error.message).toMatch(/resets at/);

    const secondary = () => new Response('', { status: 429, headers: { 'retry-after': '60' } });
    const second = await failure(new GitHubClient(fakeFetch({ '/repos/acme/letters/commits/HEAD': secondary }), 'tok').commit('acme', 'letters', undefined));
    expect(second.kind).toBe('rateLimited');
  });

  it('prefers retry-after to the primary reset when GitHub sends both', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const both = () => new Response('', { status: 403, headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4000', 'x-ratelimit-reset': String(reset) } });
    const before = Date.now();
    const error = await failure(new GitHubClient(fakeFetch({ '/repos/acme/letters/commits/HEAD': both }), 'tok').commit('acme', 'letters', undefined));
    expect(error.kind).toBe('rateLimited');
    expect(error.resetAt!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(error.resetAt!.getTime()).toBeLessThan(before + 120_000);
  });

  it('maps a fetch failure to a network error', async () => {
    const fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const error = await failure(new GitHubClient(fetch, 'tok').commit('acme', 'letters', undefined));
    expect(error.kind).toBe('network');
  });

  it('lists the .docx templates under the folder from one recursive tree', async () => {
    const fetch = fakeFetch({
      [`/repos/acme/letters/git/trees/${COMMIT}?recursive=1`]: () =>
        json({
          sha: 'root',
          truncated: false,
          tree: [
            treeEntry('forms', 't-forms'),
            blobEntry('forms/A.docx', 'a', 10),
            blobEntry('forms/sub/B.DOCX', 'b', 20),
            blobEntry('forms/~$A.docx'),
            blobEntry('forms/readme.md'),
            blobEntry('formsextra/C.docx'),
            blobEntry('other/D.docx'),
          ],
        }),
    });
    const templates = await new GitHubClient(fetch, 'tok').templates('acme', 'letters', COMMIT, 'forms');
    expect(templates).toEqual([
      { path: 'forms/A.docx', sha: 'a', size: 10 },
      { path: 'forms/sub/B.DOCX', sha: 'b', size: 20 },
    ]);
    expect(fetch.calls).toHaveLength(1);
  });

  it('walks the folder tree by tree when the recursive listing is truncated', async () => {
    const fetch = fakeFetch({
      [`/repos/acme/letters/git/trees/${COMMIT}?recursive=1`]: () => json({ sha: 'root', truncated: true, tree: [] }),
      [`/repos/acme/letters/git/trees/${COMMIT}`]: () =>
        json({ sha: 'root', truncated: false, tree: [treeEntry('forms', 't-forms'), treeEntry('other', 't-other'), blobEntry('Top.docx')] }),
      '/repos/acme/letters/git/trees/t-forms': () =>
        json({ sha: 't-forms', truncated: false, tree: [blobEntry('A.docx', 'a'), treeEntry('sub', 't-sub'), treeEntry('more', 't-more')] }),
      '/repos/acme/letters/git/trees/t-sub': () => json({ sha: 't-sub', truncated: false, tree: [blobEntry('B.docx', 'b'), treeEntry('deep', 't-deep')] }),
      '/repos/acme/letters/git/trees/t-more': () => json({ sha: 't-more', truncated: false, tree: [blobEntry('C.docx', 'c')] }),
      '/repos/acme/letters/git/trees/t-deep': () => json({ sha: 't-deep', truncated: false, tree: [blobEntry('D.docx', 'd')] }),
    });
    const templates = await new GitHubClient(fetch, 'tok').templates('acme', 'letters', COMMIT, 'forms');
    expect(templates.map((t) => t.path)).toEqual(['forms/A.docx', 'forms/more/C.docx', 'forms/sub/B.docx', 'forms/sub/deep/D.docx']);
    expect(fetch.calls.map((c) => c.url)).not.toContain('https://api.github.com/repos/acme/letters/git/trees/t-other');
  });

  it('stops walking a truncated tree at the first failure', async () => {
    const folders = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const held = gate();
    const fetch = fakeFetch({
      [`/repos/acme/letters/git/trees/${COMMIT}?recursive=1`]: () => json({ sha: 'root', truncated: true, tree: [] }),
      [`/repos/acme/letters/git/trees/${COMMIT}`]: () => json({ sha: 'root', truncated: false, tree: folders.map((f) => treeEntry(f, `t-${f}`)) }),
      '/repos/acme/letters/git/trees/t-f0': () => new Response('', { status: 500, statusText: 'Server Error' }),
      ...Object.fromEntries(
        folders.slice(1).map((f) => [`/repos/acme/letters/git/trees/t-${f}`, async () => (await held.wait, json({ sha: `t-${f}`, truncated: false, tree: [] }))]),
      ),
    });
    const walk = new GitHubClient(fetch, 'tok').templates('acme', 'letters', COMMIT, '');
    const error = await failure(walk);
    expect(error.status).toBe(500);
    const started = fetch.calls.filter((c) => /trees\/t-f\d+$/.test(c.url));
    expect(started.slice(1).every((c) => c.signal?.aborted)).toBe(true);
    held.open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetch.calls.filter((c) => /trees\/t-f\d+$/.test(c.url))).toHaveLength(started.length);
    expect(started.length).toBeLessThanOrEqual(8);
  });

  it('lists nothing when the folder is missing from a truncated tree', async () => {
    const fetch = fakeFetch({
      [`/repos/acme/letters/git/trees/${COMMIT}?recursive=1`]: () => json({ sha: 'root', truncated: true, tree: [] }),
      [`/repos/acme/letters/git/trees/${COMMIT}`]: () => json({ sha: 'root', truncated: false, tree: [treeEntry('other', 't-other')] }),
    });
    expect(await new GitHubClient(fetch, 'tok').templates('acme', 'letters', COMMIT, 'forms')).toEqual([]);
  });

  it('keeps .docx files and skips Word lock files', () => {
    expect(isTemplate('a/B.docx', '')).toBe(true);
    expect(isTemplate('a/~$B.docx', '')).toBe(false);
    expect(isTemplate('a/B.docx', 'a')).toBe(true);
    expect(isTemplate('ab/B.docx', 'a')).toBe(false);
  });
});
