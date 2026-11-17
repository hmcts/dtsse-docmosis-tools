import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscodeTypes from 'vscode';
import { PreviewProvider } from '../src/previewProvider';
import { FakePanel, stub, Uri } from './vscodeStub';

const TREE = [
  { type: 'field', text: "{dateFormat(d,'d MMMM yyyy','dd/MM/yyyy')}", dataRefs: ['d'], children: [] },
  { type: 'field', text: "{dateFormat(served,'d MMMM yyyy')}", dataRefs: ['served'], children: [] },
];

/** A workspace with a fake docmosis CLI that takes `delay` seconds, and a fake template library. */
function workspace(delay: number) {
  const root = mkdtempSync(join(tmpdir(), 'tp-session-'));
  const cliDir = join(root, 'tools');
  mkdirSync(join(cliDir, 'bin'), { recursive: true });
  mkdirSync(join(cliDir, 'lib'), { recursive: true });
  writeFileSync(
    join(cliDir, 'lib', 'docx.mjs'),
    `export const readTemplate = (f) => f;\nexport const instructionTree = () => [{ part: 'word/document.xml', children: ${JSON.stringify(TREE)} }];\n`,
  );
  const cli = join(cliDir, 'bin', 'docmosis');
  writeFileSync(
    cli,
    `#!/usr/bin/env bash\nsleep ${delay}\nwhile [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done\necho %PDF-fake > "$out"\n`,
  );
  chmodSync(cli, 0o755);
  const docx = join(root, 'Templates', 'T.docx');
  mkdirSync(join(root, 'Templates'));
  writeFileSync(docx, 'not read by the fake library');
  stub.workspaceRoot = root;
  stub.settings = { docmosisCli: cli };
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
