import { describe, expect, it } from 'vitest';
import { ghToken, resolveToken } from '../src/library/auth';

describe('GitHub token', () => {
  it("prefers VS Code's session and falls back to the GitHub CLI", async () => {
    expect(await resolveToken({ session: async () => 'vs', gh: async () => 'cli' })).toEqual({ value: 'vs', source: 'vscode' });
    expect(await resolveToken({ session: async () => undefined, gh: async () => 'cli' })).toEqual({ value: 'cli', source: 'gh' });
    expect(await resolveToken({ session: () => Promise.reject(new Error('no')), gh: async () => undefined })).toBeUndefined();
  });

  it("reads gh's token, and gives up quietly when gh is missing or signed out", async () => {
    const args: string[][] = [];
    const ok = await ghToken((file, a, _options, callback) => {
      args.push([file, ...a]);
      callback(null, 'gho_abc\n');
    });
    expect(ok).toBe('gho_abc');
    expect(args).toEqual([['gh', 'auth', 'token', '--hostname', 'github.com']]);
    expect(await ghToken((_f, _a, _o, callback) => callback(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), ''))).toBeUndefined();
    expect(await ghToken((_f, _a, _o, callback) => callback(null, ''))).toBeUndefined();
  });
});
