import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';

const launcher = resolve(__dirname, '../dist/cli/docmosis');
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

  it('runs the VS Code Node with the system CA and proxy switches', () => {
    const fake = join(tmp, 'fake-node');
    writeFileSync(
      fake,
      `#!/bin/sh\nif [ "$1" = -p ]; then echo 1; exit 0; fi\necho "$ELECTRON_RUN_AS_NODE $NODE_USE_ENV_PROXY $*"\n`,
      { mode: 0o755 },
    );
    const r = run({ DOCMOSIS_FORCE_VSCODE_NODE: '1', DOCMOSIS_VSCODE_NODE: fake }, 'x', 'y');
    expect(r.stdout.trim()).toMatch(/^1 1 --use-system-ca .*docmosis-cli\.mjs x y$/);
  });

  it('omits --use-system-ca when the VS Code Node lacks it', () => {
    const fake = join(tmp, 'old-node');
    writeFileSync(fake, `#!/bin/sh\nif [ "$1" = -p ]; then echo 0; exit 0; fi\necho "$*"\n`, { mode: 0o755 });
    const r = run({ DOCMOSIS_FORCE_VSCODE_NODE: '1', DOCMOSIS_VSCODE_NODE: fake }, 'x');
    expect(r.stdout).not.toContain('--use-system-ca');
  });

  it('explains itself when there is no usable Node', () => {
    const r = run({ PATH: tmp, DOCMOSIS_FORCE_VSCODE_NODE: '1' }, '--help');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/needs Node 24 or newer/);
  });
});
