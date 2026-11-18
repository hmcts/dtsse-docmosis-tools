import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscodeTypes from 'vscode';
import { gitBlobSha } from '../src/library/blobCache';
import { COMMANDS, TemplateLibraryView, type Node } from '../src/library/view';
import { VIEW_TYPE } from '../src/previewProvider';
import { blobEntry, fakeFetch, json } from './libraryFakes';
import { stub, type TreeItem } from './vscodeStub';

const DOCX = new TextEncoder().encode('docx bytes');
const SHA = gitBlobSha(DOCX);

function repo(name: string, files = [blobEntry('forms/A.docx', SHA, DOCX.length), blobEntry('forms/sub/B.docx')]) {
  return {
    [`/repos/acme/${name}/commits/HEAD`]: () => new Response('c1', { headers: { etag: '"c1"' } }),
    [`/repos/acme/${name}/git/trees/c1?recursive=1`]: () => json({ sha: 't1', truncated: false, tree: files }),
    [`/repos/acme/${name}/git/blobs/${SHA}`]: () => new Response(DOCX),
  };
}

function view(fetch = fakeFetch({ ...repo('letters'), ...repo('orders') })) {
  const storage = mkdtempSync(join(tmpdir(), 'tp-view-'));
  const context = { globalStorageUri: { fsPath: storage } } as unknown as vscodeTypes.ExtensionContext;
  const output = { appendLine: () => undefined } as unknown as vscodeTypes.OutputChannel;
  const provider = new TemplateLibraryView(context, output, { fetch, ghToken: async () => undefined });
  return { provider, fetch, storage };
}

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
    const file = join(storage, 'libraries', 'acme', 'letters', 'forms', 'A.docx');
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
});
