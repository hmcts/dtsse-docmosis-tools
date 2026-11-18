import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscodeTypes from 'vscode';
import { KeyStore } from '../../src/notify/keyVault';
import { NotifyPanels } from '../../src/notify/panel';
import { NotifyService } from '../../src/notify/service';
import { NotifySidebar } from '../../src/notify/sidebar';
import { FakePanel, resetStub, stub, Uri } from '../vscodeStub';
import { KEY, SERVICE } from './fixtures';

const TEMPLATE = {
  id: '9c8b7a6d-0000-4000-8000-000000000001',
  type: 'email',
  name: 'Hearing notice',
  version: 3,
  subject: 'Hearing for ((case number))',
  body: 'Dear ((name)),\n\n((remote??Join by video.))',
};

interface Call {
  method: string;
  path: string;
  body?: unknown;
  token: string;
}

/** A workspace, and a Notify API that answers after `delay` ms. */
function setUp(delay = 0) {
  const root = mkdtempSync(join(tmpdir(), 'tp-notify-'));
  resetStub(root);
  process.env.NOTIFY_API_URL = 'https://notify.test';
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = url.replace('https://notify.test', '');
    const body = init.body ? (JSON.parse(init.body as string) as { personalisation: Record<string, string> }) : undefined;
    calls.push({ method: init.method!, path, body, token: (init.headers as Record<string, string>).Authorization! });
    await new Promise((r) => setTimeout(r, delay));
    if (path === '/v2/templates') return Response.json({ templates: [TEMPLATE] });
    if (path === `/v2/template/${TEMPLATE.id}`) return Response.json(TEMPLATE);
    if (path === `/v2/template/${TEMPLATE.id}/preview`) {
      const p = body!.personalisation;
      return Response.json({ id: TEMPLATE.id, type: 'email', version: 3, subject: `Hearing for ${p['case number']}`, body: `Dear ${p.name}`, html: `<p>Dear ${p.name}</p>` });
    }
    return Response.json({ status_code: 404, errors: [{ error: 'NoResultFound', message: 'No result found' }] }, { status: 404 });
  });
  const context = {
    extensionUri: Uri.file('/ext'),
    globalStorageUri: Uri.file(join(root, '.global')),
    globalState: { get: () => undefined, update: () => Promise.resolve() },
  } as unknown as vscodeTypes.ExtensionContext;
  const output = { appendLine: () => undefined } as unknown as vscodeTypes.OutputChannel;
  const reads: string[] = [];
  const service = new NotifyService(
    new KeyStore(async (vault, secret) => {
      reads.push(`${vault}/${secret}`);
      return KEY;
    }),
  );
  const panels = new NotifyPanels(context, output, service);
  const sidebar = new NotifySidebar(context, output, service, panels);
  const folder = join(root, '.hmcts-template-preview', 'notify', 'sptribs', TEMPLATE.id);
  return { root, calls, reads, service, panels, sidebar, folder };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const posted = (panel: FakePanel, type: string) => panel.posted.filter((m) => m.type === type);

async function opened(env: ReturnType<typeof setUp>): Promise<FakePanel> {
  await env.sidebar.openTemplate('sptribs', TEMPLATE.id);
  const panel = stub.panels.at(-1)!;
  panel.send({ type: 'ready' });
  await until(() => posted(panel, 'init').length + posted(panel, 'loadError').length > 0, 'init');
  return panel;
}

describe('Notify editor panel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFY_API_URL;
  });

  it('opens a template from the side view and previews it through Notify', async () => {
    const env = setUp();
    const panel = await opened(env);
    expect(panel.title).toBe('Notify: Hearing notice');
    expect(panel.webview.html).toContain("script-src 'nonce-");
    expect(panel.webview.html).toContain('notify-editor.js');
    expect(posted(panel, 'init')[0]).toMatchObject({
      template: { id: TEMPLATE.id, name: 'Hearing notice', type: 'email', version: 3, subject: TEMPLATE.subject, body: TEMPLATE.body },
      data: {},
      dataPath: join('.hmcts-template-preview', 'notify', 'sptribs', TEMPLATE.id, 'default.json'),
      staleDraft: false,
    });
    expect(env.reads).toEqual(['sptribs-aat/uk-gov-notify-api-key']);

    panel.send({ type: 'preview', id: 1, data: { name: 'Ann', remote: true } });
    await until(() => posted(panel, 'preview').length > 0, 'the preview');
    expect(posted(panel, 'preview')[0]).toMatchObject({
      request: 1,
      preview: { subject: 'Hearing for ((case number))', body: 'Dear Ann', html: '<p>Dear Ann</p>' },
      missing: ['case number'],
    });
    const call = env.calls.find((c) => c.method === 'POST')!;
    expect(call.body).toEqual({ personalisation: { 'case number': '((case number))', name: 'Ann', remote: 'yes' } });
    const claims = JSON.parse(Buffer.from(call.token.slice(7).split('.')[1]!, 'base64url').toString()) as { iss: string };
    expect(claims.iss).toBe(SERVICE);
  });

  it('reuses the panel for a template that is already open', async () => {
    const env = setUp();
    await opened(env);
    await env.sidebar.openTemplate('sptribs', TEMPLATE.id);
    expect(stub.panels).toHaveLength(1);
    expect(stub.panels[0]!.revealed).toBe(1);
  });

  it('drops a preview overtaken by a newer request', async () => {
    const env = setUp(150);
    const panel = await opened(env);
    panel.send({ type: 'preview', id: 1, data: { name: 'Old' } });
    await until(() => posted(panel, 'previewing').length > 0, 'the first preview to start');
    panel.send({ type: 'preview', id: 2, data: { name: 'New' } });
    await until(() => posted(panel, 'preview').length > 0, 'a preview');
    await sleep(400);
    expect(posted(panel, 'preview').map((m) => m.request)).toEqual([2]);
  });

  it('saves the data and the draft, and removes the draft on revert', async () => {
    const env = setUp();
    const panel = await opened(env);
    panel.send({ type: 'dataChanged', data: { name: 'Ann' } });
    await until(() => existsSync(join(env.folder, 'default.json')), 'the data file');
    expect(JSON.parse(readFileSync(join(env.folder, 'default.json'), 'utf8'))).toEqual({ name: 'Ann' });
    expect(readFileSync(join(env.root, '.hmcts-template-preview', '.gitignore'), 'utf8')).toBe('*\n');

    panel.send({ type: 'saveDraft', subject: TEMPLATE.subject, body: `${TEMPLATE.body}\n\n((new_field))` });
    await until(() => existsSync(join(env.folder, 'draft.json')), 'the draft');
    expect(JSON.parse(readFileSync(join(env.folder, 'draft.json'), 'utf8'))).toEqual({
      subject: TEMPLATE.subject,
      body: `${TEMPLATE.body}\n\n((new_field))`,
      baseVersion: 3,
    });

    panel.send({ type: 'discardDraft' });
    await until(() => !existsSync(join(env.folder, 'draft.json')), 'the draft to go');
  });

  it('warns when Notify has a newer version than the draft was started from', async () => {
    const env = setUp();
    mkdirSync(env.folder, { recursive: true });
    writeFileSync(join(env.folder, 'draft.json'), JSON.stringify({ subject: 's', body: 'b ((x))', baseVersion: 1 }));
    const panel = await opened(env);
    expect(posted(panel, 'init')[0]).toMatchObject({ draft: { subject: 's', body: 'b ((x))', baseVersion: 1 }, staleDraft: true });

    panel.send({ type: 'saveDraft', subject: 's', body: 'b ((x)) ((y))' });
    await until(() => readFileSync(join(env.folder, 'draft.json'), 'utf8').includes('((y))'), 'the draft to save');
    expect(JSON.parse(readFileSync(join(env.folder, 'draft.json'), 'utf8'))).toMatchObject({ baseVersion: 1 });
  });

  it('copies, diffs and opens the template in Notify', async () => {
    const env = setUp();
    const panel = await opened(env);
    panel.send({ type: 'copy', what: 'body', text: 'the body' });
    await until(() => stub.clipboard === 'the body', 'the clipboard');

    panel.send({ type: 'showDiff', subject: 'New subject', body: 'New body' });
    await until(() => stub.executed.some((c) => c.command === 'vscode.diff'), 'the diff');
    const [left, right] = stub.executed.find((c) => c.command === 'vscode.diff')!.args as Uri[];
    expect(env.panels.documents.provideTextDocumentContent(left as never)).toBe(`Subject: ${TEMPLATE.subject}\n\n${TEMPLATE.body}\n`);
    expect(env.panels.documents.provideTextDocumentContent(right as never)).toBe('Subject: New subject\n\nNew body\n');

    panel.send({ type: 'openInNotify' });
    await until(() => stub.opened.length > 0, 'the browser');
    expect(stub.opened[0]).toBe(`https://www.notifications.service.gov.uk/services/${SERVICE}/templates/${TEMPLATE.id}`);
  });

  it('shows why the key could not be read', async () => {
    const env = setUp();
    env.service.keys.forget();
    const failing = new NotifyService(new KeyStore(() => Promise.reject(new Error('Forbidden: you have no read access to secrets in the Key Vault amp-aat.'))));
    const context = { extensionUri: Uri.file('/ext'), globalStorageUri: Uri.file(env.root) } as unknown as vscodeTypes.ExtensionContext;
    const panels = new NotifyPanels(context, { appendLine: () => undefined } as never, failing);
    panels.open(failing.product('sptribs')!, { id: TEMPLATE.id, name: 'x' });
    const panel = stub.panels.at(-1)!;
    panel.send({ type: 'ready' });
    await until(() => posted(panel, 'loadError').length > 0, 'the error');
    expect(posted(panel, 'loadError')[0]).toMatchObject({ message: 'Forbidden: you have no read access to secrets in the Key Vault amp-aat.' });
  });
});

describe('Notify side view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFY_API_URL;
  });

  function resolved(env: ReturnType<typeof setUp>) {
    const view = new FakePanel();
    env.sidebar.resolveWebviewView(view as unknown as vscodeTypes.WebviewView);
    return view;
  }

  it('lists the products, then the chosen product’s templates', async () => {
    const env = setUp();
    const view = resolved(env);
    view.send({ type: 'ready' });
    await until(() => posted(view, 'init').length > 0, 'init');
    const init = posted(view, 'init')[0] as unknown as { products: { id: string }[]; selected?: string };
    expect(init.products.some((p) => p.id === 'sptribs')).toBe(true);
    expect(init.selected).toBeUndefined();

    view.send({ type: 'selectProduct', product: 'sptribs' });
    await until(() => posted(view, 'templates').length > 0, 'templates');
    expect(posted(view, 'loading')[0]).toMatchObject({ product: 'sptribs', message: 'Reading the API key from sptribs-aat…' });
    expect(posted(view, 'templates')[0]).toMatchObject({
      product: 'sptribs',
      templates: [{ id: TEMPLATE.id, name: 'Hearing notice', type: 'email' }],
    });

    view.send({ type: 'refresh' });
    await until(() => posted(view, 'templates').length > 1, 'the refresh');
    expect(env.calls.filter((c) => c.path === '/v2/templates')).toHaveLength(2);
    expect(env.reads).toHaveLength(1);

    view.send({ type: 'forgetKey' });
    await until(() => posted(view, 'status').length > 0, 'the status');
    view.send({ type: 'refresh' });
    await until(() => posted(view, 'templates').length > 2, 'the reload');
    expect(env.reads).toHaveLength(2);
  });
});
