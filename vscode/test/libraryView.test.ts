import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscodeTypes from 'vscode';
import { gitBlobSha } from '../src/library/blobCache';
import { MIN_CHECK_INTERVAL_MS } from '../src/library/indexStore';
import { COMMANDS, TemplateLibraryView, type Node } from '../src/library/view';
import { VIEW_TYPE } from '../src/previewProvider';
import { blobEntry, fakeFetch, gate, json, unauthorized } from './libraryFakes';
import { stub, type TreeItem } from './vscodeStub';

const DOCX = new TextEncoder().encode('docx bytes');
const SHA = gitBlobSha(DOCX);

function repo(name: string, files = [blobEntry('forms/A.docx', SHA, DOCX.length), blobEntry('forms/sub/B.docx')], held?: Promise<void>) {
  return {
    [`/repos/acme/${name}/commits/HEAD`]: async () => {
      await held;
      return new Response('c1', { headers: { etag: '"c1"' } });
    },
    [`/repos/acme/${name}/git/trees/c1?recursive=1`]: () => json({ sha: 't1', truncated: false, tree: files }),
    [`/repos/acme/${name}/git/blobs/${SHA}`]: () => new Response(DOCX),
  };
}

function view(fetch = fakeFetch({ ...repo('letters'), ...repo('orders') }), gh: () => Promise<string | undefined> = async () => undefined) {
  const storage = mkdtempSync(join(tmpdir(), 'tp-view-'));
  const context = { globalStorageUri: { fsPath: storage } } as unknown as vscodeTypes.ExtensionContext;
  const lines: string[] = [];
  const output = { appendLine: (line: string) => lines.push(line) } as unknown as vscodeTypes.OutputChannel;
  const provider = new TemplateLibraryView(context, output, { fetch, ghToken: gh });
  return { provider, fetch, storage, lines };
}

const changeSettings = (settings: Record<string, unknown>) => {
  stub.settings = settings;
  for (const listener of stub.configListeners) listener({ affectsConfiguration: () => true });
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const calls = (fetch: { calls: { url: string }[] }, part: string) => fetch.calls.filter((call) => call.url.includes(part));

const state = () => stub.executed.filter(([command, key]) => command === 'setContext' && key === 'hmctsTemplatePreview.templates.state').at(-1)?.[2];
const labels = (provider: TemplateLibraryView, nodes: Node[]) => nodes.map((node) => (provider.getTreeItem(node) as unknown as TreeItem).label);

async function settle(provider: TemplateLibraryView): Promise<void> {
  await stub.commands.get(COMMANDS.refresh)?.();
  await provider.getChildren();
}

describe('Templates view', () => {
  beforeEach(() => {
    stub.settings = { templateLibraries: [{ repo: 'acme/letters', path: 'forms' }] };
    stub.executed = [];
    stub.infos = [];
    stub.errors = [];
    stub.commands = new Map();
    stub.githubSession = 'tok';
    stub.signInSession = undefined;
    stub.configListeners = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for the configuration when no libraries are set', async () => {
    stub.settings = {};
    const { provider, fetch } = view();
    expect(await provider.getChildren()).toEqual([]);
    expect(state()).toBe('noLibraries');
    expect(fetch.calls).toHaveLength(0);
  });

  it("doesn't touch the network until the view asks for its children", () => {
    const { fetch } = view();
    expect(fetch.calls).toHaveLength(0);
  });

  it('lists a single library without a library level', async () => {
    const { provider } = view();
    await settle(provider);
    const root = await provider.getChildren();
    expect(labels(provider, root)).toEqual(['sub', 'A.docx']);
    expect(state()).toBe('ready');
    const item = provider.getTreeItem(root[1]!) as unknown as TreeItem;
    expect(item.description).toBe('10 B');
    expect(item.tooltip).toContain('acme/letters/forms/A.docx');
    expect(item.command?.command).toBe(COMMANDS.open);
  });

  it('groups by library when several are configured', async () => {
    stub.settings = { templateLibraries: [{ repo: 'acme/letters', label: 'Letters' }, { repo: 'acme/orders', label: 'Orders' }] };
    const { provider } = view();
    await settle(provider);
    const root = await provider.getChildren();
    expect(labels(provider, root)).toEqual(['Letters', 'Orders']);
    expect(labels(provider, await provider.getChildren(root[0]))).toEqual(['forms']);
  });

  it('shows the sign-in state when there is no token', async () => {
    stub.githubSession = undefined;
    const { provider, fetch } = view();
    await provider.getChildren();
    await settle(provider);
    expect(state()).toBe('signedOut');
    expect(fetch.calls).toHaveLength(0);
  });

  it('lists the templates once the user signs in', async () => {
    stub.githubSession = undefined;
    stub.signInSession = 'signed-in';
    const { provider, fetch } = view();
    await settle(provider);
    expect(state()).toBe('signedOut');
    await stub.commands.get(COMMANDS.signIn)?.();
    expect(state()).toBe('ready');
    expect(fetch.calls[0]?.headers.authorization).toBe('Bearer signed-in');
  });

  it('downloads a template on first open and opens the cached copy after that', async () => {
    const { provider, fetch, storage } = view();
    await settle(provider);
    const [, template] = await provider.getChildren();
    await stub.commands.get(COMMANDS.open)?.(template);
    const file = join(storage, 'libraries', 'acme', 'letters', 'default', 'forms', 'A.docx');
    expect(readFileSync(file, 'utf8')).toBe('docx bytes');
    const opened = stub.executed.filter(([command]) => command === 'vscode.openWith');
    expect(opened.map(([, uri, type]) => [(uri as { fsPath: string }).fsPath, type])).toEqual([[file, VIEW_TYPE]]);

    const before = fetch.calls.length;
    await stub.commands.get(COMMANDS.open)?.(template);
    expect(fetch.calls.length).toBe(before);
    expect(stub.executed.filter(([command]) => command === 'vscode.openWith')).toHaveLength(2);
  });

  it('reports a missing repo', async () => {
    const { provider } = view(fakeFetch({}));
    await settle(provider);
    expect(state()).toBe('error');
    expect(stub.errors.join('\n')).toMatch(/acme\/letters doesn't exist/);
  });

  it('lists a library added while a check is running', async () => {
    const held = gate();
    const { provider, fetch } = view(fakeFetch({ ...repo('letters', undefined, held.wait), ...repo('orders') }));
    await provider.getChildren();
    changeSettings({ templateLibraries: [{ repo: 'acme/letters', label: 'Letters' }, { repo: 'acme/orders', label: 'Orders' }] });
    await vi.waitFor(() => expect(calls(fetch, '/acme/orders/git/trees/')).toHaveLength(1));
    held.open();
    await vi.waitFor(async () => expect(labels(provider, await provider.getChildren())).toEqual(['Letters', 'Orders']));
    const [, orders] = await provider.getChildren();
    expect(labels(provider, await provider.getChildren(orders))).toEqual(['forms']);
  });

  it("doesn't bring back a library removed while its check was running", async () => {
    stub.settings = { templateLibraries: [{ repo: 'acme/letters' }, { repo: 'acme/orders' }] };
    const held = gate();
    const { provider, fetch } = view(fakeFetch({ ...repo('letters', []), ...repo('orders', undefined, held.wait) }));
    const refresh = stub.commands.get(COMMANDS.refresh)?.() as Promise<void>;
    await vi.waitFor(() => expect(calls(fetch, '/acme/orders/commits/')).toHaveLength(1));
    changeSettings({ templateLibraries: [{ repo: 'acme/letters' }] });
    held.open();
    await refresh;
    await tick();
    expect(state()).toBe('empty');
    expect(await provider.getChildren()).toEqual([]);
  });

  it("falls back to the GitHub CLI's token when GitHub rejects VS Code's session", async () => {
    stub.githubSession = 'revoked';
    const fetch = fakeFetch({
      ...repo('letters'),
      '/repos/acme/letters/commits/HEAD': ({ headers }) =>
        headers.authorization === 'Bearer revoked' ? unauthorized() : new Response('c1', { headers: { etag: '"c1"' } }),
    });
    const { provider } = view(fetch, async () => 'cli');
    await settle(provider);
    expect(state()).toBe('ready');
    expect(stub.errors).toEqual([]);
    await stub.commands.get(COMMANDS.refresh)?.();
    expect(fetch.calls.filter((call) => call.headers.authorization === 'Bearer revoked')).toHaveLength(1);
    expect(fetch.calls.at(-1)?.headers.authorization).toBe('Bearer cli');
  });

  it('asks the user to sign in once both tokens are rejected, without retrying them', async () => {
    stub.githubSession = 'revoked';
    const fetch = fakeFetch({ '/repos/acme/letters/commits/HEAD': unauthorized });
    const { provider } = view(fetch, async () => 'also-revoked');
    await settle(provider);
    expect(state()).toBe('signedOut');
    expect(fetch.calls.map((call) => call.headers.authorization)).toEqual(['Bearer revoked', 'Bearer also-revoked']);
    await stub.commands.get(COMMANDS.refresh)?.();
    expect(fetch.calls).toHaveLength(2);
    expect(stub.infos.join('\n')).toMatch(/Sign in to GitHub/);
  });

  it('logs a repeated library entry', () => {
    stub.settings = { templateLibraries: [{ repo: 'acme/letters' }, { repo: 'ACME/letters' }] };
    const { lines } = view();
    expect(lines.join('\n')).toMatch(/entry 2 repeats entry 1/);
  });

  it('opens a cached template without a GitHub token', async () => {
    const { provider } = view();
    await settle(provider);
    const [, template] = await provider.getChildren();
    await stub.commands.get(COMMANDS.open)?.(template);
    stub.githubSession = undefined;
    await stub.commands.get(COMMANDS.open)?.(template);
    expect(stub.executed.filter(([command]) => command === 'vscode.openWith')).toHaveLength(2);
    expect(stub.infos).toEqual([]);
  });

  describe('when the list is older than the check interval', () => {
    const V2 = new TextEncoder().encode('docx bytes, version two');
    const SHA2 = gitBlobSha(V2);

    function moving() {
      const head = { sha: 'c1', held: Promise.resolve() };
      const fetch = fakeFetch({
        '/repos/acme/letters/commits/HEAD': async ({ headers }) => {
          await head.held;
          return headers['if-none-match'] === `"${head.sha}"` ? new Response(null, { status: 304 }) : new Response(head.sha, { headers: { etag: `"${head.sha}"` } });
        },
        '/repos/acme/letters/git/trees/c1?recursive=1': () => json({ sha: 't1', truncated: false, tree: [blobEntry('forms/A.docx', SHA, DOCX.length)] }),
        '/repos/acme/letters/git/trees/c2?recursive=1': () => json({ sha: 't2', truncated: false, tree: [blobEntry('forms/A.docx', SHA2, V2.length)] }),
        [`/repos/acme/letters/git/blobs/${SHA}`]: () => new Response(DOCX),
        [`/repos/acme/letters/git/blobs/${SHA2}`]: () => new Response(V2),
      });
      return { head, fetch };
    }

    async function openedOnce() {
      const { head, fetch } = moving();
      const { provider, storage } = view(fetch);
      await settle(provider);
      const [template] = await provider.getChildren();
      await stub.commands.get(COMMANDS.open)?.(template);
      const later = Date.now() + MIN_CHECK_INTERVAL_MS + 1000;
      vi.spyOn(Date, 'now').mockReturnValue(later);
      return { head, fetch, provider, template, file: join(storage, 'libraries', 'acme', 'letters', 'default', 'forms', 'A.docx') };
    }

    it("opens the cached copy at once, then downloads a newer version over it", async () => {
      const { head, fetch, template, file } = await openedOnce();
      head.sha = 'c2';
      const held = gate();
      head.held = held.wait;
      await stub.commands.get(COMMANDS.open)?.(template);
      expect(stub.executed.filter(([command]) => command === 'vscode.openWith')).toHaveLength(2);
      expect(readFileSync(file, 'utf8')).toBe('docx bytes');
      held.open();
      await vi.waitFor(() => expect(readFileSync(file, 'utf8')).toBe('docx bytes, version two'));
      expect(calls(fetch, `/git/blobs/${SHA2}`)).toHaveLength(1);
    });

    it('makes one conditional request when nothing changed', async () => {
      const { fetch, template } = await openedOnce();
      const before = fetch.calls.length;
      await stub.commands.get(COMMANDS.open)?.(template);
      await vi.waitFor(() => expect(fetch.calls.length).toBe(before + 1));
      await tick();
      expect(fetch.calls.slice(before).map((call) => [new URL(call.url).pathname, call.headers['if-none-match']])).toEqual([
        ['/repos/acme/letters/commits/HEAD', '"c1"'],
      ]);
    });
  });
});
