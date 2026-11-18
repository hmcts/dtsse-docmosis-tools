import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { parseWorkspaceYaml, type RepoEntry } from '../core/workspaceYaml';

export class CftWorkspace implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  root: string | undefined;
  repos: RepoEntry[] = [];

  constructor() {
    this.load();
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.fsPath === this.manifestPath()) this.reload();
      }),
    );
  }

  private manifestPath(): string | undefined {
    return this.root ? join(this.root, 'workspace.yaml') : undefined;
  }

  private load(): void {
    this.root = vscode.workspace.workspaceFolders
      ?.map((folder) => folder.uri.fsPath)
      .find((dir) => existsSync(join(dir, 'workspace.yaml')));
    this.repos = this.root ? parseWorkspaceYaml(readFileSync(join(this.root, 'workspace.yaml'), 'utf8')) : [];
  }

  private reload(): void {
    this.load();
    this.changed.fire();
  }

  isCloned = (path: string): boolean => this.root !== undefined && existsSync(join(this.root, path));

  relativePath(fsPath: string): string | undefined {
    if (!this.root || !fsPath.startsWith(this.root)) return undefined;
    return fsPath.slice(this.root.length + 1);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.changed.dispose();
  }
}
