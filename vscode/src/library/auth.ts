import { execFile } from 'node:child_process';

export type TokenSource = 'vscode' | 'gh';

export interface Token {
  value: string;
  source: TokenSource;
}

export interface TokenProviders {
  /** VS Code's GitHub session, asked for without prompting. */
  session(): Promise<string | undefined>;
  gh(): Promise<string | undefined>;
}

/**
 * The first token available: VS Code's GitHub session, then the GitHub CLI's login. Tokens in
 * `rejected`, which GitHub answered 401 for, are passed over, so a revoked session falls through to `gh`.
 */
export async function resolveToken(providers: TokenProviders, rejected: ReadonlySet<string> = new Set()): Promise<Token | undefined> {
  const fromSession = await providers.session().catch(() => undefined);
  if (fromSession && !rejected.has(fromSession)) return { value: fromSession, source: 'vscode' };
  const fromGh = await providers.gh().catch(() => undefined);
  if (fromGh && !rejected.has(fromGh)) return { value: fromGh, source: 'gh' };
  return undefined;
}

type ExecFile = (file: string, args: string[], options: { timeout: number }, callback: (error: Error | null, stdout: string) => void) => unknown;

/** The GitHub CLI's token for github.com, or undefined when `gh` isn't installed or signed in. */
export function ghToken(run: ExecFile = execFile as unknown as ExecFile): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      run('gh', ['auth', 'token', '--hostname', 'github.com'], { timeout: 5000 }, (error, stdout) => {
        const token = String(stdout ?? '').trim();
        resolve(error || !token ? undefined : token);
      });
    } catch {
      resolve(undefined);
    }
  });
}
