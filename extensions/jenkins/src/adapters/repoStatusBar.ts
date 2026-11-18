import * as vscode from 'vscode';
import type { BuildSummary } from '../core/jenkinsClient';
import { childJobUrl, repoJobUrl } from '../core/jenkinsPaths';
import { repoForPath } from '../core/products';
import { iconFor, statusFromBuild, statusWord } from '../core/status';
import type { JenkinsService } from './jenkinsService';
import type { CftWorkspace } from './workspace';

export class RepoStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private buildUrl: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private latestRequest = 0;

  constructor(
    private readonly workspace: CftWorkspace,
    private readonly jenkins: JenkinsService,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.command = 'dtsseJenkins.openStatusBuild';
  }

  schedule(): void {
    if (this.timer) clearInterval(this.timer);
    const seconds = vscode.workspace.getConfiguration('dtsseJenkins').get<number>('refreshSeconds') ?? 60;
    this.timer = setInterval(() => void this.update(), Math.max(10, seconds) * 1000);
  }

  openBuild(): void {
    if (this.buildUrl) void vscode.env.openExternal(vscode.Uri.parse(this.buildUrl));
  }

  async update(): Promise<void> {
    const request = ++this.latestRequest;
    const fsPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const relative = fsPath ? this.workspace.relativePath(fsPath) : undefined;
    const repo = relative ? repoForPath(this.workspace.repos, relative) : undefined;
    const client = repo ? await this.jenkins.client() : undefined;
    if (request !== this.latestRequest) return;
    if (!repo || !client) {
      this.item.hide();
      return;
    }
    try {
      const build = await this.lastMasterBuild(repo.name);
      if (request !== this.latestRequest) return;
      if (!build) {
        this.item.backgroundColor = undefined;
        this.item.text = `$(circle-outline) ${repo.name} master: no build`;
        this.buildUrl = undefined;
      } else {
        const status = statusFromBuild(build);
        this.item.text = `$(${iconFor(status).id}) ${repo.name} master ${statusWord(status)}`;
        this.item.backgroundColor =
          status === 'failure' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
        this.buildUrl = build.url;
      }
      this.item.tooltip = `Last master build of ${repo.name}`;
      this.item.show();
      this.jenkins.markReady();
    } catch (error) {
      if (request !== this.latestRequest) return;
      if (this.jenkins.handleError(error)) {
        this.item.backgroundColor = undefined;
        this.item.text = `$(circle-outline) ${repo.name}: no Jenkins job`;
        this.buildUrl = undefined;
        this.item.show();
      } else {
        this.item.backgroundColor = undefined;
        this.item.hide();
      }
    }
  }

  private async lastMasterBuild(repoName: string): Promise<BuildSummary | undefined> {
    const client = await this.jenkins.client();
    if (!client) return undefined;
    const repoJob = repoJobUrl(this.jenkins.baseUrl, repoName);
    try {
      return await client.getLastBuild(childJobUrl(repoJob, 'master'));
    } catch (error) {
      if (!this.jenkins.handleError(error)) throw error;
      return client.getLastBuild(childJobUrl(repoJob, 'main'));
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
