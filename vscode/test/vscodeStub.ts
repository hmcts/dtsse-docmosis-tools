/** The parts of the `vscode` API the preview session uses, for unit tests. */
import * as path from 'node:path';

type Listener<T> = (value: T) => unknown;

export class Uri {
  private constructor(readonly fsPath: string) {}
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...parts));
  }
  toString(): string {
    return `file://${this.fsPath}`;
  }
}

export class RelativePattern {
  constructor(readonly base: string, readonly pattern: string) {}
}

const disposable = { dispose: () => undefined };

export const stub = {
  settings: {} as Record<string, unknown>,
  workspaceRoot: '/',
  errors: [] as string[],
  openDialog: (): Promise<Uri[] | undefined> => Promise.resolve(undefined),
};

export const workspace = {
  get workspaceFolders() {
    return [{ uri: Uri.file(stub.workspaceRoot) }];
  },
  getWorkspaceFolder: () => ({ uri: Uri.file(stub.workspaceRoot) }),
  getConfiguration: () => ({ get: <T>(key: string, fallback: T): T => (stub.settings[key] as T) ?? fallback }),
  createFileSystemWatcher: () => ({ ...disposable, onDidChange: () => disposable, onDidCreate: () => disposable }),
};

export const window = {
  showErrorMessage: (message: string) => {
    stub.errors.push(message);
    return Promise.resolve(undefined);
  },
  showOpenDialog: () => stub.openDialog(),
};

export const commands = { executeCommand: () => Promise.resolve(undefined) };

/** A webview panel that records what the host posts and lets a test send it messages. */
export class FakePanel {
  readonly posted: { type: string; [key: string]: unknown }[] = [];
  private receive: Listener<unknown> | undefined;
  readonly webview = {
    options: {},
    html: '',
    cspSource: 'stub:',
    asWebviewUri: (uri: Uri) => uri,
    postMessage: (message: { type: string }) => {
      this.posted.push(message);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (listener: Listener<unknown>) => {
      this.receive = listener;
      return disposable;
    },
  };
  onDidDispose = () => disposable;
  send(message: unknown): void {
    this.receive?.(message);
  }
}
