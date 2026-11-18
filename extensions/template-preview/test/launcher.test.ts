import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';

const launcher = join(process.env.DOCMOSIS_TEST_CLI_DIR!, 'docmosis');
const tmp = mkdtempSync(join(tmpdir(), 'launcher-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const template = join(tmp, 't.docx');
writeFileSync(
  template,
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello &lt;&lt;name&gt;&gt;</w:t></w:r></w:p></w:body></w:document>',
    ),
  }),
);

const run = (env: Record<string, string>, ...args: string[]) =>
  spawnSync('/bin/sh', [launcher, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { PATH: process.env.PATH!, ...env },
  });

describe.skipIf(process.platform === 'win32')('bundled docmosis launcher', () => {
  it('prints help under the system Node', () => {
    const r = run({}, '--help');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^usage: docmosis <command>/);
  });

  it('reads a template under the system Node', () => {
    const r = run({}, 'text', template);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('== word/document.xml\np1\tHello <<name>>\n');
  });

  it('keeps a failing exit code', () => {
    expect(run({}, 'frobnicate').status).toBe(1);
  });

  it('falls back to the VS Code Node when forced, with ELECTRON_RUN_AS_NODE', () => {
    const r = run(
      { DOCMOSIS_FORCE_VSCODE_NODE: '1', DOCMOSIS_VSCODE_NODE: process.execPath },
      'text',
      template,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('== word/document.xml\np1\tHello <<name>>\n');
  });

  const fakeNode = (name: string) => {
    const fake = join(tmp, name);
    writeFileSync(fake, '#!/bin/sh\necho "$ELECTRON_RUN_AS_NODE $NODE_USE_ENV_PROXY $*"\n', { mode: 0o755 });
    return fake;
  };

  it('runs the VS Code Node with the flags the extension names', () => {
    const r = run(
      {
        DOCMOSIS_FORCE_VSCODE_NODE: '1',
        DOCMOSIS_VSCODE_NODE: fakeNode('fake-node'),
        DOCMOSIS_VSCODE_NODE_FLAGS: '--use-system-ca',
        DOCMOSIS_VSCODE_NODE_PROXY: '1',
      },
      'x',
      'y',
    );
    expect(r.stdout.trim()).toMatch(/^1 1 --use-system-ca .*docmosis-cli\.mjs x y$/);
    expect(r.stderr).toBe('');
  });

  it('passes no flag when the extension names none', () => {
    const r = run({ DOCMOSIS_FORCE_VSCODE_NODE: '1', DOCMOSIS_VSCODE_NODE: fakeNode('old-node') }, 'x');
    expect(r.stdout).not.toContain('--use-system-ca');
    expect(r.stdout.trim()).toMatch(/^1 1 \S*docmosis-cli\.mjs x$/);
  });

  it('warns that a proxy is ignored when the VS Code Node cannot use it', () => {
    const r = run(
      { DOCMOSIS_FORCE_VSCODE_NODE: '1', DOCMOSIS_VSCODE_NODE: fakeNode('no-proxy-node'), HTTPS_PROXY: 'http://p:1' },
      'x',
    );
    expect(r.stderr).toBe(
      'docmosis: the Node in VS Code ignores HTTPS_PROXY and HTTP_PROXY; install Node 24 or newer on PATH to use the proxy\n',
    );
    expect(r.status).toBe(0);
  });

  it('does not warn without a proxy variable', () => {
    const r = run({ DOCMOSIS_FORCE_VSCODE_NODE: '1', DOCMOSIS_VSCODE_NODE: fakeNode('quiet-node') }, 'x');
    expect(r.stderr).toBe('');
  });

  it('explains itself when there is no usable Node', () => {
    const r = run({ PATH: tmp, DOCMOSIS_FORCE_VSCODE_NODE: '1' }, '--help');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/needs Node 24 or newer/);
  });
});
