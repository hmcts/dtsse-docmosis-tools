import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
  type AlertState,
  anyPending,
  EMPTY_ALERT_STATE,
  evaluate,
  type FinishedEvent,
  formatAlert,
  formatInputAlert,
  jenkinsStatusOf,
  markInput,
} from '../core/alerts';
import { type OpenPr, searchMyOpenPrs } from '../core/github';
import { firstFailedStage, pausedStage } from '../core/jenkinsClient';
import { parseBuildUrl } from '../core/jenkinsPaths';
import { acquireLease, IDLE_POLL_MS, type Lease, nextPollDelay, releaseLease } from '../core/scheduler';
import { type InvestigateTarget, investigate } from './investigate';
import type { JenkinsService } from './jenkinsService';
import type { CftWorkspace } from './workspace';

const STATE_KEY = 'dtsseJenkins.alertState';
const LEASE_KEY = 'dtsseJenkins.alertLease';

export async function githubToken(createIfNone: boolean): Promise<string | undefined> {
  const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone });
  return session?.accessToken;
}

export class PrAlerts implements vscode.Disposable {
  private readonly windowId = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private offeredSignIn = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspace: CftWorkspace,
    private readonly jenkins: JenkinsService,
  ) {}

  start(): void {
    this.stopped = false;
    this.schedule(5000);
  }

  restart(): void {
    if (this.timer) clearTimeout(this.timer);
    this.start();
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    let delay = IDLE_POLL_MS;
    try {
      delay = await this.poll();
    } catch (error) {
      console.warn(`HMCTS Jenkins PR alerts: ${(error as Error).message}`);
    }
    this.schedule(delay);
  }

  private async poll(): Promise<number> {
    const config = vscode.workspace.getConfiguration('dtsseJenkins');
    if (!config.get<boolean>('prAlerts.enabled', true)) return IDLE_POLL_MS;

    const globalState = this.context.globalState;
    const { leader, lease } = acquireLease(globalState.get<Lease>(LEASE_KEY), this.windowId, Date.now());
    if (!leader) return IDLE_POLL_MS;
    await globalState.update(LEASE_KEY, lease);

    const token = await githubToken(false);
    if (!token) {
      void this.offerSignIn();
      return IDLE_POLL_MS;
    }

    let prs = await searchMyOpenPrs(token);
    if (config.get<string>('prAlerts.scope', 'workspace') === 'workspace') {
      const slugs = new Set(this.workspace.repos.map((repo) => repo.slug.toLowerCase()));
      prs = prs.filter((pr) => slugs.has(pr.slug.toLowerCase()));
    }

    const previous = globalState.get<AlertState>(STATE_KEY) ?? EMPTY_ALERT_STATE;
    const { next, events } = evaluate(previous, prs);
    await globalState.update(STATE_KEY, next);
    for (const event of events) void this.notifyFinished(event);
    await this.checkInputs(prs);
    return nextPollDelay(anyPending(prs));
  }

  private async checkInputs(prs: OpenPr[]): Promise<void> {
    for (const pr of prs) {
      const status = jenkinsStatusOf(pr.statuses);
      const build =
        status?.state === 'pending' && status.targetUrl ? parseBuildUrl(status.targetUrl) : undefined;
      if (!build) continue;
      try {
        const client = await this.jenkins.client(8000);
        const stage = client ? pausedStage(await client.getStages(build.buildUrl)) : undefined;
        if (!stage) continue;
        const marked = markInput(
          this.context.globalState.get<AlertState>(STATE_KEY) ?? EMPTY_ALERT_STATE,
          build.buildUrl,
        );
        if (!marked.isNew) continue;
        await this.context.globalState.update(STATE_KEY, marked.state);
        const choice = await vscode.window.showWarningMessage(
          formatInputAlert(pr, stage.name),
          'Open Build',
          'Open PR',
        );
        if (choice === 'Open Build') void vscode.env.openExternal(vscode.Uri.parse(build.buildUrl));
        else if (choice === 'Open PR') void vscode.env.openExternal(vscode.Uri.parse(pr.url));
      } catch {
        // Off the VPN the stages are unreachable; the status-based alerts still work.
      }
    }
  }

  private async notifyFinished(event: FinishedEvent): Promise<void> {
    const build = event.targetUrl ? parseBuildUrl(event.targetUrl) : undefined;
    const target: InvestigateTarget | undefined = build && {
      repo: event.pr.repo,
      jobName: build.jobName ?? `PR-${event.pr.number}`,
      buildNumber: build.number,
      buildUrl: build.buildUrl,
      branch: event.pr.headRef,
      commit: event.pr.headSha,
    };
    const detail: { failedStage?: string; durationMs?: number } = {};
    if (build) {
      try {
        const client = await this.jenkins.client(8000);
        if (client) {
          const info = await client.getBuild(build.buildUrl);
          if (info.duration) detail.durationMs = info.duration;
          if (event.state !== 'success') {
            const failed = firstFailedStage(await client.getStages(build.buildUrl))?.name;
            if (failed) {
              detail.failedStage = failed;
              if (target) target.failedStage = failed;
            }
          }
        }
      } catch {
        // Not on the VPN: alert without the enrichment.
      }
    }

    const message = formatAlert(event, detail);
    const buttons = ['Open Build', 'Open PR'];
    if (event.state !== 'success' && target) buttons.push('Investigate with Claude');
    const show =
      event.state === 'success' ? vscode.window.showInformationMessage : vscode.window.showErrorMessage;
    const choice = await show(message, ...buttons);
    if (choice === 'Open Build') {
      void vscode.env.openExternal(vscode.Uri.parse(build?.buildUrl ?? event.targetUrl ?? event.pr.url));
    } else if (choice === 'Open PR') {
      void vscode.env.openExternal(vscode.Uri.parse(event.pr.url));
    } else if (choice === 'Investigate with Claude' && target) {
      await investigate(target, this.workspace, this.jenkins);
    }
  }

  private async offerSignIn(): Promise<void> {
    if (this.offeredSignIn) return;
    this.offeredSignIn = true;
    const choice = await vscode.window.showInformationMessage(
      'Sign in to GitHub to get alerts when your pull request builds finish.',
      'Sign in',
    );
    if (choice) await vscode.commands.executeCommand('dtsseJenkins.signInToGitHub');
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const lease = releaseLease(this.context.globalState.get<Lease>(LEASE_KEY), this.windowId);
    await this.context.globalState.update(LEASE_KEY, lease);
  }
}
