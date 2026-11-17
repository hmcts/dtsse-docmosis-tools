import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscodeTypes from 'vscode';
import { PreviewProvider } from '../src/previewProvider';
import { FakePanel, stub, Uri } from './vscodeStub';

const TREE = [
  { type: 'field', text: "{dateFormat(d,'d MMMM yyyy','dd/MM/yyyy')}", dataRefs: ['d'], children: [] },
  { type: 'field', text: "{dateFormat(served,'d MMMM yyyy')}", dataRefs: ['served'], children: [] },
];

vi.mock('@hmcts-cft/docmosis-tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hmcts-cft/docmosis-tools')>()),
  readTemplate: (file: string) => file,
  instructionTree: () => [{ part: 'word/document.xml', children: TREE }],
}));

/** A workspace with a template, and a doc-render service that takes `delay` seconds to answer. */
function workspace(delay: number) {
  const root = mkdtempSync(join(tmpdir(), 'tp-session-'));
  const docx = join(root, 'Templates', 'T.docx');
  mkdirSync(join(root, 'Templates'));
  writeFileSync(docx, 'not read by the fake library');
  vi.stubGlobal('fetch', async () => {
    await new Promise((r) => setTimeout(r, delay * 1000));
    return new Response('%PDF-fake', { headers: { 'content-type': 'application/pdf' } });
  });
  stub.workspaceRoot = root;
  stub.settings = {};
  stub.errors = [];
  return { root, docx };
}

function open(root: string, docx: string): FakePanel {
  const context = { extensionUri: Uri.file('/ext'), storageUri: Uri.file(join(root, '.storage')) };
  const output = { append: () => undefined, appendLine: () => undefined, show: () => undefined };
  const provider = new PreviewProvider(context as unknown as vscodeTypes.ExtensionContext, output as unknown as vscodeTypes.OutputChannel);
  const panel = new FakePanel();
  const document = provider.openCustomDocument(Uri.file(docx) as unknown as vscodeTypes.Uri);
  provider.resolveCustomEditor(document, panel as unknown as vscodeTypes.WebviewPanel);
  return panel;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const types = (panel: FakePanel) => panel.posted.map((m) => m.type);

describe('PreviewSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    stub.openDialog = () => Promise.resolve(undefined);
  });

  async function started(delay: number) {
    const { root, docx } = workspace(delay);
    const panel = open(root, docx);
    panel.send({ type: 'ready' });
    await until(() => types(panel).includes('init'), 'init');
    return { root, panel };
  }

  it('discards a render in flight when the host refuses newer data', async () => {
    const { panel } = await started(0.3);
    panel.send({ type: 'render', id: 1, data: { d: '01/02/2020' }, dev: false });
    await until(() => types(panel).includes('rendering'), 'the first render to start');
    panel.send({ type: 'render', id: 2, data: { d: 'nonsense' }, dev: false });
    await until(() => types(panel).includes('invalid'), 'the refusal');
    expect(panel.posted.find((m) => m.type === 'invalid')).toMatchObject({ request: 2 });
    await sleep(500);
    expect(types(panel)).not.toContain('pdf');
    expect(types(panel)).not.toContain('renderError');

    panel.send({ type: 'render', id: 3, data: { d: '01/02/2020' }, dev: false });
    await until(() => types(panel).includes('pdf'), 'the next render');
    expect(panel.posted.find((m) => m.type === 'pdf')).toMatchObject({ request: 3 });
  });

  it('discards a render in flight when the webview refuses newer data', async () => {
    const { panel } = await started(0.3);
    panel.send({ type: 'render', id: 1, data: { d: '01/02/2020' }, dev: false });
    await until(() => types(panel).includes('rendering'), 'the render to start');
    panel.send({ type: 'cancelRender' });
    await sleep(500);
    expect(types(panel)).not.toContain('pdf');
    expect(types(panel)).not.toContain('renderError');
  });

  it('renders a date-time in a date whose template names no input format', async () => {
    const { panel } = await started(0);
    panel.send({ type: 'render', id: 1, data: { served: '2024-05-01T10:00:00' }, dev: false });
    await until(() => types(panel).some((t) => t === 'invalid' || t === 'pdf'), 'a result');
    expect(types(panel)).toContain('pdf');
  });

  it('tells the user when saving the data fails', async () => {
    const { root, panel } = await started(0);
    writeFileSync(join(root, '.hmcts-template-preview'), 'a file where the folder should be');
    panel.send({ type: 'saveData', data: { d: 'x' } });
    await until(() => stub.errors.length > 0, 'an error message');
    expect(stub.errors[0]).toMatch(/couldn't save \.hmcts-template-preview\/Templates\/T\/default\.json/);
    expect(panel.posted.at(-1)).toMatchObject({ type: 'info', message: expect.stringMatching(/^Couldn't save/) });
  });

  it('shows an error for any message the host fails to handle', async () => {
    const { panel } = await started(0);
    stub.openDialog = () => Promise.reject(new Error('dialog broke'));
    panel.send({ type: 'loadData' });
    await until(() => stub.errors.length > 0, 'an error message');
    expect(stub.errors[0]).toBe('HMCTS Template Preview: dialog broke');
  });
});
