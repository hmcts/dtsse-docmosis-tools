import * as vscode from 'vscode';
import { formatDuration, relativeTime } from '../core/format';
import type { BuildSummary, JenkinsViewJob, JobSummary, Stage } from '../core/jenkinsClient';
import { decodeJobName, prNumberOf, repoJobUrl } from '../core/jenkinsPaths';
import { classifyJobs, masterJobsFromView } from '../core/jobTree';
import { iconFor, statusFromBuild, statusFromColor, statusFromStage, statusWord } from '../core/status';
import type { Team } from '../core/teams';
import { buildTeams } from '../core/teams';
import type { RepoEntry } from '../core/workspaceYaml';
import type { JenkinsService } from './jenkinsService';
import type { CftWorkspace } from './workspace';

export interface BuildTarget {
  repo: RepoEntry;
  jobName: string;
  jobUrl: string;
  build: BuildSummary;
}

type Node =
  | { kind: 'team'; team: Team }
  | { kind: 'repo'; repo: RepoEntry; masterStatus?: ReturnType<typeof statusFromColor> }
  | { kind: 'group'; label: string; repo: RepoEntry; jobs: Array<{ job: JobSummary; pr?: number }> }
  | { kind: 'job'; label: string; repo: RepoEntry; job: JobSummary; pr?: number }
  | { kind: 'build'; target: BuildTarget; pr?: number }
  | { kind: 'stage'; stage: Stage; target: BuildTarget }
  | { kind: 'message'; text: string };

export interface NodeInfo {
  url?: string;
  prUrl?: string;
  failedBuild?: BuildTarget & { pr?: number };
}

function themeIcon(status: ReturnType<typeof statusFromBuild>): vscode.ThemeIcon {
  const icon = iconFor(status);
  return new vscode.ThemeIcon(icon.id, icon.color ? new vscode.ThemeColor(icon.color) : undefined);
}

export function infoOf(node: unknown): NodeInfo {
  const n = node as Node | undefined;
  if (n?.kind === 'team') return n.team.view ? { url: n.team.view.url } : {};
  if (n?.kind === 'job') {
    return { url: n.job.url, ...(n.pr !== undefined ? { prUrl: prUrl(n.repo, n.pr) } : {}) };
  }
  if (n?.kind !== 'build' && n?.kind !== 'stage') return {};
  const { target } = n;
  const pr = prNumberOf(target.jobName);
  const info: NodeInfo = { url: target.build.url };
  if (pr !== undefined) info.prUrl = prUrl(target.repo, pr);
  const status = statusFromBuild(target.build);
  if (n.kind === 'build' && (status === 'failure' || status === 'unstable')) {
    info.failedBuild = { ...target, ...(pr !== undefined ? { pr } : {}) };
  }
  return info;
}

export function prUrl(repo: RepoEntry, number: number): string {
  return `https://github.com/${repo.slug}/pull/${number}`;
}

export class PipelineTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private timer: NodeJS.Timeout | undefined;
  private visible = true;

  constructor(
    private readonly jenkins: JenkinsService,
    private readonly workspace: CftWorkspace,
  ) {}

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.refresh();
    this.schedule();
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.visible) return;
    const seconds = vscode.workspace.getConfiguration('dtsseJenkins').get<number>('refreshSeconds') ?? 60;
    this.timer = setInterval(() => this.refresh(), Math.max(10, seconds) * 1000);
  }

  async getChildren(node?: Node): Promise<Node[]> {
    try {
      return await this.children(node);
    } catch (error) {
      if (this.jenkins.handleError(error)) return [{ kind: 'message', text: 'No Jenkins job' }];
      return [];
    }
  }

  private async children(node?: Node): Promise<Node[]> {
    if (!node) return this.roots();
    switch (node.kind) {
      case 'team':
        return node.team.repos.map((repo) => this.repoNode(node.team.view?.jobs ?? [], repo));
      case 'repo':
        return this.repoChildren(node.repo);
      case 'group':
        return node.jobs.map(({ job, pr }) => ({
          kind: 'job' as const,
          label: pr !== undefined ? `PR-${pr}` : decodeJobName(job.name),
          repo: node.repo,
          job,
          ...(pr !== undefined ? { pr } : {}),
        }));
      case 'job':
        return this.buildNodes(node);
      case 'build':
        return this.stageNodes(node.target);
      default:
        return [];
    }
  }

  private async roots(): Promise<Node[]> {
    const client = await this.jenkins.client();
    if (!client) return [];
    const config = vscode.workspace.getConfiguration('dtsseJenkins');
    let views: Awaited<ReturnType<typeof client.listViewsWithJobs>>;
    try {
      views = await client.listViewsWithJobs();
    } catch (error) {
      this.jenkins.handleError(error);
      return [];
    }
    this.jenkins.markReady();
    return buildTeams(this.workspace.repos, views, config.get<Record<string, string>>('productViews')).map(
      (team) => ({ kind: 'team' as const, team }),
    );
  }

  private repoNode(viewJobs: JenkinsViewJob[], repo: RepoEntry): Node {
    const main = masterJobsFromView(viewJobs, repo.name).main;
    return { kind: 'repo', repo, ...(main ? { masterStatus: statusFromColor(main.color) } : {}) };
  }

  private async repoChildren(repo: RepoEntry): Promise<Node[]> {
    const client = await this.jenkins.client();
    if (!client) return [];
    const [main, nightly] = await Promise.all([
      client.listJobs(repoJobUrl(this.jenkins.baseUrl, repo.name)),
      client.listJobs(repoJobUrl(this.jenkins.baseUrl, repo.name, true)).catch((error) => {
        if (this.jenkins.handleError(error)) return [] as JobSummary[];
        throw error;
      }),
    ]);
    const jobs = classifyJobs(main, nightly);
    const nodes: Node[] = [];
    if (jobs.master)
      nodes.push({ kind: 'job', label: decodeJobName(jobs.master.name), repo, job: jobs.master });
    if (jobs.nightly)
      nodes.push({
        kind: 'job',
        label: `Nightly ${decodeJobName(jobs.nightly.name)}`,
        repo,
        job: jobs.nightly,
      });
    if (jobs.branches.length > 0) {
      nodes.push({
        kind: 'group',
        label: `Branches (${jobs.branches.length})`,
        repo,
        jobs: jobs.branches.map((job) => ({ job })),
      });
    }
    if (jobs.prs.length > 0) {
      nodes.push({
        kind: 'group',
        label: `Pull requests (${jobs.prs.length})`,
        repo,
        jobs: jobs.prs.map(({ job, number }) => ({ job, pr: number })),
      });
    }
    return nodes.length > 0 ? nodes : [{ kind: 'message', text: 'No Jenkins job' }];
  }

  private async buildNodes(node: Extract<Node, { kind: 'job' }>): Promise<Node[]> {
    const client = await this.jenkins.client();
    if (!client) return [];
    const detail = await client.getJob(node.job.url);
    if (detail.builds.length === 0) return [{ kind: 'message', text: 'No builds yet' }];
    const jobName = decodeJobName(node.job.name);
    return detail.builds.map((build) => ({
      kind: 'build' as const,
      target: { repo: node.repo, jobName, jobUrl: node.job.url, build },
      ...(node.pr !== undefined ? { pr: node.pr } : {}),
    }));
  }

  private async stageNodes(target: BuildTarget): Promise<Node[]> {
    const client = await this.jenkins.client();
    if (!client) return [];
    const stages = await client.getStages(target.build.url);
    return stages.map((stage) => ({ kind: 'stage' as const, stage, target }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'message':
        return new vscode.TreeItem(node.text);
      case 'team': {
        const { team } = node;
        const item = new vscode.TreeItem(team.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = themeIcon(team.status);
        item.description = `${team.repos.length} ${team.repos.length === 1 ? 'repo' : 'repos'}`;
        item.tooltip = [team.product, team.view?.url ?? 'No Jenkins view'].join('\n');
        item.contextValue = team.view ? 'teamWithView' : 'team';
        return item;
      }
      case 'repo': {
        const item = new vscode.TreeItem(node.repo.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = node.masterStatus ? themeIcon(node.masterStatus) : new vscode.ThemeIcon('repo');
        if (node.masterStatus) item.description = `master ${statusWord(node.masterStatus)}`;
        item.tooltip = node.repo.slug;
        item.contextValue = 'repo';
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon(
          node.jobs[0]?.pr !== undefined ? 'git-pull-request' : 'git-branch',
        );
        return item;
      }
      case 'job': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        const build = node.job.lastBuild;
        const status = build ? statusFromBuild(build) : statusFromColor(node.job.color);
        item.iconPath = themeIcon(status);
        item.description = build
          ? `#${build.number} ${statusWord(status)}${build.timestamp ? ` · ${relativeTime(build.timestamp, Date.now())}` : ''}`
          : 'not built';
        item.contextValue = node.pr !== undefined ? 'jenkins pr job' : 'jenkins job';
        item.tooltip = node.job.url;
        return item;
      }
      case 'build': {
        const { build } = node.target;
        const status = statusFromBuild(build);
        const item = new vscode.TreeItem(`#${build.number}`, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = themeIcon(status);
        const parts: string[] = [statusWord(status)];
        if (!build.building && build.duration) parts.push(formatDuration(build.duration));
        if (build.timestamp) parts.push(relativeTime(build.timestamp, Date.now()));
        item.description = parts.join(' · ');
        const failed = status === 'failure' || status === 'unstable';
        item.contextValue = [
          'jenkins',
          'build',
          node.pr !== undefined ? 'pr' : '',
          failed ? 'failedBuild' : '',
        ]
          .filter(Boolean)
          .join(' ');
        item.tooltip = build.url;
        return item;
      }
      case 'stage': {
        const { target } = node;
        const item = new vscode.TreeItem(node.stage.name);
        item.iconPath = themeIcon(statusFromStage(node.stage.status));
        item.description = [
          node.stage.status === 'PAUSED_PENDING_INPUT' ? 'waiting for input' : '',
          node.stage.durationMillis ? formatDuration(node.stage.durationMillis) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        item.contextValue = target.jobName.startsWith('PR-') ? 'jenkins pr stage' : 'jenkins stage';
        return item;
      }
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.changed.dispose();
  }
}
