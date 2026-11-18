/** The parts of the `vscode` API the extension uses, for unit tests. */
import * as path from 'node:path';

type Listener<T> = (value: T) => unknown;

export class Uri {
  private constructor(
    readonly fsPath: string,
    readonly scheme = 'file',
  ) {}
  get path(): string {
    return this.fsPath;
  }
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  static from({ scheme, path: p }: { scheme: string; path: string }): Uri {
    return new Uri(p, scheme);
  }
  static parse(value: string): Uri {
    const url = new URL(value);
    return Object.assign(new Uri(url.pathname, url.protocol.slice(0, -1)), { toString: () => value });
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...parts), base.scheme);
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

export class EventEmitter<T> {
  private readonly listeners: Listener<T>[] = [];
  readonly event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return disposable;
  };
  fire(value: T): void {
    this.listeners.forEach((l) => l(value));
  }
  dispose(): void {
    this.listeners.length = 0;
  }
}

export enum ViewColumn {
  Active = -1,
}

export class RelativePattern {
  constructor(readonly base: string, readonly pattern: string) {}
}

const disposable = { dispose: () => undefined };

export const stub = {
  settings: {} as Record<string, unknown>,
  workspaceRoot: '/',
  errors: [] as string[],
  configListeners: [] as Array<(event: { affectsConfiguration(section: string): boolean }) => unknown>,
  openDialog: (): Promise<Uri[] | undefined> => Promise.resolve(undefined),
  panels: [] as FakePanel[],
  executed: [] as { command: string; args: unknown[] }[],
  clipboard: '',
  opened: [] as string[],
  infos: [] as string[],
};

/** Clears what the stub has recorded. */
export function resetStub(root = '/'): void {
  stub.workspaceRoot = root;
  stub.settings = {};
  stub.errors = [];
  stub.panels = [];
  stub.executed = [];
  stub.clipboard = '';
  stub.opened = [];
  stub.infos = [];
}

export const workspace = {
  get workspaceFolders() {
    return [{ uri: Uri.file(stub.workspaceRoot) }];
  },
  getWorkspaceFolder: () => ({ uri: Uri.file(stub.workspaceRoot) }),
  getConfiguration: () => ({ get: <T>(key: string, fallback: T): T => (stub.settings[key] as T) ?? fallback }),
  onDidChangeConfiguration: (listener: (typeof stub.configListeners)[number]) => {
    stub.configListeners.push(listener);
    return disposable;
  },
  createFileSystemWatcher: () => ({ ...disposable, onDidChange: () => disposable, onDidCreate: () => disposable }),
  registerTextDocumentContentProvider: () => disposable,
};

export const env = {
  clipboard: {
    writeText: (text: string) => {
      stub.clipboard = text;
      return Promise.resolve();
    },
  },
  openExternal: (uri: Uri) => {
    stub.opened.push(uri.toString());
    return Promise.resolve(true);
  },
};

export const window = {
  showErrorMessage: (message: string) => {
    stub.errors.push(message);
    return Promise.resolve(undefined);
  },
  showInformationMessage: (message: string) => {
    stub.infos.push(message);
    return Promise.resolve(undefined);
  },
  showOpenDialog: () => stub.openDialog(),
  createOutputChannel: () => ({ ...disposable, appendLine: () => undefined }),
  registerCustomEditorProvider: () => disposable,
  registerWebviewViewProvider: () => disposable,
  createWebviewPanel: (_viewType: string, title: string) => {
    const panel = new FakePanel();
    panel.title = title;
    stub.panels.push(panel);
    return panel;
  },
};

export const commands = {
  executeCommand: (command: string, ...args: unknown[]) => {
    stub.executed.push({ command, args });
    return Promise.resolve(undefined);
  },
  registerCommand: () => disposable,
};

/** An environment variable collection that records what the extension asked for. */
export class FakeEnvCollection {
  description: string | undefined;
  readonly entries = new Map<string, { type: 'prepend' | 'replace'; value: string }>();
  prepend(name: string, value: string): void {
    this.entries.set(name, { type: 'prepend', value });
  }
  replace(name: string, value: string): void {
    this.entries.set(name, { type: 'replace', value });
  }
  clear(): void {
    this.entries.clear();
    this.description = undefined;
  }
}

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
  title = '';
  revealed = 0;
  private disposed: (() => void) | undefined;
  onDidDispose = (listener: () => void) => {
    this.disposed = listener;
    return disposable;
  };
  reveal(): void {
    this.revealed++;
  }
  dispose(): void {
    this.disposed?.();
  }
  send(message: unknown): void {
    this.receive?.(message);
  }
}
