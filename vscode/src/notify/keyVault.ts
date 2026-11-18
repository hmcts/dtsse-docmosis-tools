import { execFile } from 'node:child_process';

export class KeyVaultError extends Error {}

const TIMEOUT_MS = 60_000;

interface ExecFailure extends Error {
  code?: string | number;
  killed?: boolean;
  stderr?: string;
}

function run(args: string[]): Promise<string> {
  // Windows installs az as az.cmd, which execFile can only start through cmd.exe. The arguments
  // are vault and secret names already limited to letters, digits and hyphens.
  const [file, fileArgs] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'az', ...args]] : ['az', args];
  return new Promise((resolve, reject) => {
    execFile(file, fileArgs, { timeout: TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: String(stderr ?? '') }));
      else resolve(String(stdout));
    });
  });
}

function explain(error: ExecFailure, vault: string, secret: string): KeyVaultError {
  const stderr = error.stderr ?? '';
  if (error.code === 'ENOENT' || /is not recognized as an internal or external command/i.test(stderr)) {
    return new KeyVaultError("The Azure CLI (az) isn't installed or isn't on the PATH. Install it, then run `az login`.");
  }
  if (error.killed) return new KeyVaultError(`az took longer than ${TIMEOUT_MS / 1000}s to read ${secret} from ${vault}.`);
  if (/az login|AADSTS|refresh token|InteractionRequired|expired|not logged in/i.test(stderr)) {
    return new KeyVaultError('Your Azure CLI session has expired or you are not signed in: run `az login`, then try again.');
  }
  if (/Forbidden|does not have secrets get permission|AuthorizationFailed|\b403\b/i.test(stderr)) {
    return new KeyVaultError(`Forbidden: you have no read access to secrets in the Key Vault ${vault}.`);
  }
  if (/SecretNotFound/i.test(stderr)) return new KeyVaultError(`The Key Vault ${vault} has no secret named ${secret}.`);
  if (/getaddrinfo|ENOTFOUND|Failed to resolve|Name or service not known/i.test(stderr)) {
    return new KeyVaultError(`Couldn't reach the Key Vault ${vault}: check the name and your network.`);
  }
  const detail = stderr.split('\n').map((l) => l.trim()).find(Boolean) ?? error.message;
  return new KeyVaultError(`az couldn't read ${secret} from ${vault}: ${detail}`);
}

/** Reads a secret with the user's own `az` login. */
export async function readSecret(vault: string, secret: string): Promise<string> {
  let stdout: string;
  try {
    stdout = await run(['keyvault', 'secret', 'show', '--vault-name', vault, '--name', secret, '--query', 'value', '-o', 'tsv']);
  } catch (error) {
    throw explain(error as ExecFailure, vault, secret);
  }
  const value = stdout.trim();
  if (!value) throw new KeyVaultError(`The secret ${secret} in ${vault} is empty.`);
  return value;
}

/** Keeps keys read from Key Vault in memory for the session; nothing is written to disk. */
export class KeyStore {
  private readonly keys = new Map<string, Promise<string>>();

  constructor(private readonly read: (vault: string, secret: string) => Promise<string> = readSecret) {}

  get(vault: string, secret: string): Promise<string> {
    const id = `${vault}/${secret}`;
    let key = this.keys.get(id);
    if (!key) {
      key = this.read(vault, secret);
      this.keys.set(id, key);
      key.catch(() => {
        if (this.keys.get(id) === key) this.keys.delete(id);
      });
    }
    return key;
  }

  has(vault: string, secret: string): boolean {
    return this.keys.has(`${vault}/${secret}`);
  }

  forget(): void {
    this.keys.clear();
  }
}
