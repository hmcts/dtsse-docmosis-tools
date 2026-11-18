import { beforeEach, describe, expect, it, vi } from 'vitest';

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

const { KeyStore, KeyVaultError, readSecret } = await import('../../src/notify/keyVault');

/** Answers each az call through its callback, as execFile does. */
function respond(result: Error | null, stdout: string, stderr: string): void {
  execFile.mockImplementation((...args: unknown[]) => {
    const callback = args[3];
    if (typeof callback === 'function') (callback as Callback)(result, stdout, stderr);
  });
}

const answer = (stdout: string) => respond(null, stdout, '');
const fail = (stderr: string, extra: Record<string, unknown> = {}) =>
  respond(Object.assign(new Error('Command failed'), { code: 1, ...extra }), '', stderr);

describe('readSecret', () => {
  beforeEach(() => execFile.mockReset());

  it('runs az without a shell and returns the trimmed value', async () => {
    answer('the-key\n');
    expect(await readSecret('sptribs-aat', 'uk-gov-notify-api-key')).toBe('the-key');
    const [file, args, options] = execFile.mock.calls[0]!;
    if (process.platform === 'win32') {
      expect(file).toBe('cmd.exe');
    } else {
      expect(file).toBe('az');
      expect(args).toEqual(['keyvault', 'secret', 'show', '--vault-name', 'sptribs-aat', '--name', 'uk-gov-notify-api-key', '--query', 'value', '-o', 'tsv']);
    }
    expect(options).not.toHaveProperty('shell');
  });

  it.each([
    ['az is missing', '', { code: 'ENOENT' }, "The Azure CLI (az) isn't installed or isn't on the PATH. Install it, then run `az login`."],
    ['not signed in', "ERROR: Please run 'az login' to setup account.", {}, 'Your Azure CLI session has expired or you are not signed in: run `az login`, then try again.'],
    [
      'the login expired',
      'ERROR: AADSTS700082: The refresh token has expired due to inactivity.',
      {},
      'Your Azure CLI session has expired or you are not signed in: run `az login`, then try again.',
    ],
    [
      'no access',
      "ERROR: (Forbidden) The user, group or application does not have secrets get permission on key vault 'amp-aat'.",
      {},
      'Forbidden: you have no read access to secrets in the Key Vault amp-aat.',
    ],
    ['no such secret', "ERROR: (SecretNotFound) A secret with (name/id) x was not found in this key vault.", {}, 'The Key Vault amp-aat has no secret named x.'],
    ['anything else', 'ERROR: something odd\nmore', {}, "az couldn't read x from amp-aat: ERROR: something odd"],
  ])('explains %s', async (_name, stderr, extra, expected) => {
    fail(stderr, extra);
    const error = await readSecret('amp-aat', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyVaultError);
    expect((error as Error).message).toBe(expected);
  });

  it('refuses an empty secret', async () => {
    answer('\n');
    await expect(readSecret('v', 's')).rejects.toThrow('The secret s in v is empty.');
  });
});

describe('KeyStore', () => {
  it('reads each key once until it is forgotten', async () => {
    const read = vi.fn(async (vault: string, secret: string) => `${vault}:${secret}`);
    const keys = new KeyStore(read);
    expect(await keys.get('v', 's')).toBe('v:s');
    expect(await keys.get('v', 's')).toBe('v:s');
    expect(read).toHaveBeenCalledTimes(1);
    expect(keys.has('v', 's')).toBe(true);
    keys.forget();
    expect(keys.has('v', 's')).toBe(false);
    await keys.get('v', 's');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep a failed read", async () => {
    const read = vi.fn().mockRejectedValueOnce(new KeyVaultError('no')).mockResolvedValueOnce('key');
    const keys = new KeyStore(read);
    await expect(keys.get('v', 's')).rejects.toThrow('no');
    expect(await keys.get('v', 's')).toBe('key');
  });
});
