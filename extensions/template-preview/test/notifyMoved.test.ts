import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const host = vi.hoisted(() => ({
  setting: undefined as { globalValue?: unknown } | undefined,
  installed: false,
  choice: undefined as string | undefined,
  messages: [] as string[],
  executed: [] as unknown[][],
}));

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ inspect: () => host.setting }) },
  extensions: { getExtension: () => (host.installed ? {} : undefined) },
  window: {
    showInformationMessage: (message: string) => {
      host.messages.push(message);
      return Promise.resolve(host.choice);
    },
  },
  commands: { executeCommand: (...args: unknown[]) => host.executed.push(args) },
}));

const { noticeNotifyMoved } = await import('../src/notifyMoved');

function context(state: Record<string, unknown> = {}) {
  return {
    state,
    globalState: { get: (key: string) => state[key], update: (key: string, value: unknown) => Promise.resolve((state[key] = value)) },
  } as unknown as vscode.ExtensionContext & { state: Record<string, unknown> };
}

describe('noticeNotifyMoved', () => {
  beforeEach(() => Object.assign(host, { setting: undefined, installed: false, choice: undefined, messages: [], executed: [] }));

  it('stays quiet for someone who never used Notify', () => {
    noticeNotifyMoved(context());
    expect(host.messages).toEqual([]);
  });

  it('tells someone who chose a Notify product, once', () => {
    const ctx = context({ 'notify.product': 'pcs' });
    noticeNotifyMoved(ctx);
    noticeNotifyMoved(ctx);
    expect(host.messages).toHaveLength(1);
  });

  it('tells someone who set the old products setting', () => {
    host.setting = { globalValue: [] };
    noticeNotifyMoved(context());
    expect(host.messages).toHaveLength(1);
  });

  it('stays quiet when the new extension is installed', () => {
    host.installed = true;
    noticeNotifyMoved(context({ 'notify.product': 'pcs' }));
    expect(host.messages).toEqual([]);
  });

  it('installs the new extension on Install', async () => {
    host.choice = 'Install';
    noticeNotifyMoved(context({ 'notify.product': 'pcs' }));
    await vi.waitFor(() => expect(host.executed).toEqual([['workbench.extensions.installExtension', 'hmcts.hmcts-notify']]));
  });
});
