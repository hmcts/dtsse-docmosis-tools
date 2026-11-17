import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activate } from '../src/extension';
import { cmdStub, shStub, supportsEnvProxy } from '../src/terminalCommand';
import { FakeEnvCollection, stub } from './vscodeStub';

const storage = mkdtempSync(path.join(tmpdir(), 'terminal-command-'));
afterAll(() => rmSync(storage, { recursive: true, force: true }));

function activated(extensionPath = '/ext/hmcts') {
  const env = new FakeEnvCollection();
  const context = {
    extensionPath,
    extensionUri: { fsPath: extensionPath },
    globalStorageUri: { fsPath: storage },
    environmentVariableCollection: env,
    subscriptions: [] as unknown[],
  };
  activate(context as never);
  return env;
}

const changed = (key: string) => stub.configListeners.forEach((l) => l({ affectsConfiguration: (s) => s === key }));
const binDir = path.join(storage, 'bin');

describe('terminal command', () => {
  beforeEach(() => {
    stub.settings = {};
    stub.configListeners = [];
  });

  it('prepends only the stable stub directory to PATH', () => {
    const env = activated();
    expect(env.entries.get('PATH')).toEqual({ type: 'prepend', value: binDir + path.delimiter });
    expect(env.entries.size).toBe(1);
    expect(env.description).toContain('docmosis command');
  });

  it('writes an executable stub that names the current launcher and Node', () => {
    activated('/ext/hmcts-2.0.0');
    const stubFile = path.join(binDir, 'docmosis');
    expect(statSync(stubFile).mode & 0o777).toBe(0o755);
    const text = readFileSync(stubFile, 'utf8');
    expect(text).toContain(`'${path.join('/ext/hmcts-2.0.0', 'dist', 'cli', 'docmosis')}'`);
    expect(text).toContain(`DOCMOSIS_VSCODE_NODE='${process.execPath}'`);
    expect(readFileSync(path.join(binDir, 'docmosis.cmd'), 'utf8')).toContain('docmosis.cmd" %*');
  });

  it('rewrites the stub when the extension moves', () => {
    activated('/ext/one');
    activated('/ext/two');
    const text = readFileSync(path.join(binDir, 'docmosis'), 'utf8');
    expect(text).toContain('/ext/two/dist/cli/docmosis');
    expect(text).not.toContain('/ext/one');
  });

  it('adds nothing when the setting is off', () => {
    rmSync(binDir, { recursive: true, force: true });
    stub.settings = { terminalCommand: false };
    expect(activated().entries.size).toBe(0);
    expect(existsSync(binDir)).toBe(false);
  });

  it('follows the setting as it changes', () => {
    const env = activated();
    stub.settings = { terminalCommand: false };
    changed('hmctsTemplatePreview.terminalCommand');
    expect(env.entries.size).toBe(0);
    stub.settings = { terminalCommand: true };
    changed('hmctsTemplatePreview.terminalCommand');
    expect(env.entries.has('PATH')).toBe(true);
  });

  it('ignores other settings', () => {
    const env = activated();
    stub.settings = { terminalCommand: false };
    changed('editor.fontSize');
    expect(env.entries.has('PATH')).toBe(true);
  });
});

describe('stubs', () => {
  const runtime = { node: "/opt/Code Helper (Plugin)/it's", flags: '--use-system-ca', proxy: true, launcher: '/x y/dist/cli/docmosis' };

  it('quote the paths for sh', () => {
    const r = spawnSync('/bin/sh', ['-c', shStub({ ...runtime, launcher: '/usr/bin/env' }).replace('exec ', 'exec echo ')], {
      encoding: 'utf8',
    });
    expect(r.stdout.trim()).toBe('/usr/bin/env');
    expect(shStub(runtime)).toContain(`DOCMOSIS_VSCODE_NODE='/opt/Code Helper (Plugin)/it'\\''s'`);
  });

  it('double percent signs for cmd and end without a block', () => {
    const text = cmdStub({ ...runtime, node: 'C:\\100%\\Code.exe' });
    expect(text).toContain('set "DOCMOSIS_VSCODE_NODE=C:\\100%%\\Code.exe"');
    expect(text).not.toMatch(/\(/);
    expect(text).toContain('\r\n');
  });
});

describe('supportsEnvProxy', () => {
  it.each([
    ['24.0.0', true],
    ['26.1.0', true],
    ['22.21.0', true],
    ['22.20.9', false],
    ['20.18.0', false],
  ])('%s -> %s', (version, expected) => expect(supportsEnvProxy(version)).toBe(expected));
});
