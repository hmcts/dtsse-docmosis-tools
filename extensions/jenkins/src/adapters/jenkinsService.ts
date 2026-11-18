import * as vscode from 'vscode';
import { JenkinsClient, JenkinsError } from '../core/jenkinsClient';
import { loadCredentials, promptForCredentials } from './credentials';
import type { CftWorkspace } from './workspace';

export type ServiceState = 'ready' | 'noCredentials' | 'vpnDown';

export class JenkinsService implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.changed.event;
  state: ServiceState = 'ready';
  baseUrl = '';
  private cached: JenkinsClient | undefined;
  private creds: Awaited<ReturnType<typeof loadCredentials>>;
  private warnedAuth = false;

  constructor(
    private readonly workspace: CftWorkspace,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  invalidate(): void {
    this.cached = undefined;
    this.creds = undefined;
    this.warnedAuth = false;
  }

  /** Undefined when there are no credentials; the state is then `noCredentials`. */
  async client(timeoutMs?: number): Promise<JenkinsClient | undefined> {
    const creds = (this.creds ??= await loadCredentials(this.workspace.root, this.secrets));
    if (!creds) {
      this.setState('noCredentials');
      return undefined;
    }
    this.baseUrl = creds.url;
    if (timeoutMs)
      return new JenkinsClient({
        baseUrl: creds.url,
        username: creds.username,
        token: creds.token,
        timeoutMs,
      });
    this.cached ??= new JenkinsClient({ baseUrl: creds.url, username: creds.username, token: creds.token });
    return this.cached;
  }

  /** Records what an error means for the whole service. Returns true for a missing job (404). */
  handleError(error: unknown): boolean {
    if (!(error instanceof JenkinsError)) throw error;
    if (error.kind === 'notFound') return true;
    if (error.kind === 'network') this.setState('vpnDown');
    else if (error.kind === 'http') this.setState('vpnDown');
    else if (error.kind === 'auth') {
      this.setState('noCredentials');
      void this.warnAuth();
    }
    return false;
  }

  markReady(): void {
    this.setState('ready');
  }

  async setCredentials(): Promise<boolean> {
    const stored = await promptForCredentials(this.secrets);
    if (stored) {
      this.invalidate();
      this.markReady();
    }
    return stored;
  }

  private setState(state: ServiceState): void {
    if (this.state === state) return;
    this.state = state;
    this.changed.fire();
  }

  private async warnAuth(): Promise<void> {
    if (this.warnedAuth) return;
    this.warnedAuth = true;
    const choice = await vscode.window.showWarningMessage(
      'Jenkins rejected the credentials.',
      'Set Credentials',
    );
    if (choice) await vscode.commands.executeCommand('dtsseJenkins.setCredentials');
  }

  dispose(): void {
    this.changed.dispose();
  }
}
