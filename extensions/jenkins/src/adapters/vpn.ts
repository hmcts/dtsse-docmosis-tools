import { execFile } from 'node:child_process';
import { type VpnState, vpnStateFromExit } from '../core/command';

export function vpnState(): Promise<VpnState> {
  return new Promise((resolve) => {
    execFile('f5-cli', ['status'], { timeout: 10000 }, (error) => {
      if (!error) return resolve(vpnStateFromExit(0, false));
      const failure = error as NodeJS.ErrnoException & { killed?: boolean };
      if (failure.code === 'ENOENT' || failure.killed) return resolve(vpnStateFromExit(null, true));
      resolve(vpnStateFromExit(typeof failure.code === 'number' ? failure.code : 1, false));
    });
  });
}
