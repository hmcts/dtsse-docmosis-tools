import { accessSync, constants } from 'node:fs';
import * as vscode from 'vscode';
import { findOnPath, splitCommand } from '../core/command';
import { firstFailedStage } from '../core/jenkinsClient';
import { prNumberOf } from '../core/jenkinsPaths';
import { renderPrompt, terminalName } from '../core/prompt';
import type { JenkinsService } from './jenkinsService';
import { vpnState } from './vpn';
import type { CftWorkspace } from './workspace';

export interface InvestigateTarget {
  repo: string;
  jobName: string;
  buildNumber: number;
  buildUrl: string;
  branch?: string;
  commit?: string;
  failedStage?: string;
}

function executable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function investigate(
  target: InvestigateTarget,
  workspace: CftWorkspace,
  jenkins: JenkinsService,
): Promise<void> {
  const name = terminalName(target.repo, target.jobName, target.buildNumber);
  const existing = vscode.window.terminals.find((terminal) => terminal.name === name);
  if (existing) {
    existing.show();
    return;
  }

  const config = vscode.workspace.getConfiguration('dtsseJenkins');
  const { command, args } = splitCommand(config.get<string>('investigate.command') ?? 'hai');
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const resolved = findOnPath(command, process.env.PATH, executable, extensions);
  if (!resolved) {
    void vscode.window.showErrorMessage(
      `Can't find '${command}' on PATH. Install @hmcts-cft/hai-cli (npm install -g @hmcts-cft/hai-cli), or change dtsseJenkins.investigate.command.`,
    );
    return;
  }

  if ((await vpnState()) === 'down') {
    const answer = await vscode.window.showWarningMessage(
      'The VPN looks down, so Claude cannot read the Jenkins build.',
      'Continue anyway',
    );
    if (answer !== 'Continue anyway') return;
  }

  const details = { ...target };
  try {
    const client = await jenkins.client(10000);
    if (client) {
      if (!details.commit || !details.branch) {
        const revision = await client.getRevision(details.buildUrl);
        details.commit ??= revision.commit;
        details.branch ??= revision.branch;
      }
      if (!details.failedStage) {
        details.failedStage = firstFailedStage(await client.getStages(details.buildUrl))?.name;
      }
    }
  } catch {
    // Details are best effort; the prompt drops whatever is missing.
  }

  const pr = prNumberOf(target.jobName);
  const repoEntry = workspace.repos.find((entry) => entry.name === target.repo);
  const clonePath = repoEntry && workspace.root ? `${workspace.root}/${repoEntry.path}` : '';
  const prompt = renderPrompt(config.get<string>('investigate.promptTemplate') ?? '', {
    buildUrl: details.buildUrl,
    repo: target.repo,
    clonePath,
    pr: pr !== undefined ? `PR #${pr}` : '',
    branch: details.branch ?? '',
    commit: details.commit ?? '',
    failedStage: details.failedStage ?? '',
  });

  const terminal = vscode.window.createTerminal({
    name,
    shellPath: resolved,
    shellArgs: [...args, prompt],
    cwd: workspace.root,
  });
  terminal.show();
}
