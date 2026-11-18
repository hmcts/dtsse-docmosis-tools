import { delimiter, join } from 'node:path';

export function splitCommand(commandLine: string): { command: string; args: string[] } {
  const [command = '', ...args] = commandLine.trim().split(/\s+/);
  return { command, args };
}

export function findOnPath(
  command: string,
  pathEnv: string | undefined,
  exists: (candidate: string) => boolean,
  extensions: string[] = [''],
): string | undefined {
  if (command === '') return undefined;
  if (command.includes('/') || command.includes('\\')) return exists(command) ? command : undefined;
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const extension of extensions) {
      const candidate = join(dir, command + extension);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

export type VpnState = 'up' | 'down' | 'unknown';

/** `f5-cli status` exits non-zero when the tunnel is down; a missing binary says nothing about the VPN. */
export function vpnStateFromExit(exitCode: number | null, spawnFailed: boolean): VpnState {
  if (spawnFailed || exitCode === null) return 'unknown';
  return exitCode === 0 ? 'up' : 'down';
}
