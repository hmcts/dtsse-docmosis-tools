import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { activate } from '../src/extension';
import { FakeEnvCollection, stub } from './vscodeStub';

function activated() {
  const env = new FakeEnvCollection();
  const context = {
    extensionPath: '/ext/hmcts',
    extensionUri: { fsPath: '/ext/hmcts' },
    environmentVariableCollection: env,
    subscriptions: [] as unknown[],
  };
  activate(context as never);
  return env;
}

const changed = (key: string) => stub.configListeners.forEach((l) => l({ affectsConfiguration: (s) => s === key }));

describe('terminal command', () => {
  beforeEach(() => {
    stub.settings = {};
    stub.configListeners = [];
  });

  it('prepends dist/cli to PATH and names the VS Code Node', () => {
    const env = activated();
    expect(env.entries.get('PATH')).toEqual({
      type: 'prepend',
      value: path.join('/ext/hmcts', 'dist', 'cli') + path.delimiter,
    });
    expect(env.entries.get('DOCMOSIS_VSCODE_NODE')).toEqual({ type: 'replace', value: process.execPath });
    expect(env.description).toContain('docmosis command');
  });

  it('adds nothing when the setting is off', () => {
    stub.settings = { terminalCommand: false };
    expect(activated().entries.size).toBe(0);
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
