import * as vscode from 'vscode';
import { investigate } from './adapters/investigate';
import { JenkinsService } from './adapters/jenkinsService';
import { githubToken, PrAlerts } from './adapters/prAlerts';
import { ProductSelector } from './adapters/productSelector';
import { RepoStatusBar } from './adapters/repoStatusBar';
import { infoOf, PipelineTree } from './adapters/tree';
import { CftWorkspace } from './adapters/workspace';

export function activate(context: vscode.ExtensionContext): void {
  const workspace = new CftWorkspace();
  const jenkins = new JenkinsService(workspace, context.secrets);
  const products = new ProductSelector(workspace, jenkins, context.workspaceState);
  const tree = new PipelineTree(jenkins, products);
  const statusBar = new RepoStatusBar(workspace, jenkins);
  const alerts = new PrAlerts(context, workspace, jenkins);

  const view = vscode.window.createTreeView('dtsseJenkins.pipelines', { treeDataProvider: tree });

  const updateContext = () => {
    let state = 'ready';
    if (!workspace.root) state = 'noWorkspace';
    else if (!products.current()) state = 'noProduct';
    else if (jenkins.state !== 'ready') state = jenkins.state;
    void vscode.commands.executeCommand('setContext', 'dtsseJenkins.state', state);
    products.render();
  };

  const refreshAll = () => {
    jenkins.invalidate();
    tree.refresh();
    void statusBar.update();
  };

  const target = (node: unknown) => infoOf(node);
  const open = (url: string | undefined) => url && vscode.env.openExternal(vscode.Uri.parse(url));

  context.subscriptions.push(
    workspace,
    jenkins,
    products,
    tree,
    statusBar,
    view,
    { dispose: () => void alerts.dispose() },
    view.onDidChangeVisibility((event) => tree.setVisible(event.visible)),
    products.onDidChange(() => {
      updateContext();
      tree.refresh();
    }),
    jenkins.onDidChangeState(updateContext),
    workspace.onDidChange(() => {
      updateContext();
      tree.refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => void statusBar.update()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dtsseJenkins')) {
        tree.schedule();
        statusBar.schedule();
        products.render();
        tree.refresh();
      }
    }),
    vscode.commands.registerCommand('dtsseJenkins.selectProduct', () => products.select()),
    vscode.commands.registerCommand('dtsseJenkins.refresh', refreshAll),
    vscode.commands.registerCommand('dtsseJenkins.setCredentials', async () => {
      if (await jenkins.setCredentials()) refreshAll();
    }),
    vscode.commands.registerCommand('dtsseJenkins.openInJenkins', (node) => open(target(node).url)),
    vscode.commands.registerCommand('dtsseJenkins.copyLink', async (node) => {
      const url = target(node).url;
      if (url) await vscode.env.clipboard.writeText(url);
    }),
    vscode.commands.registerCommand('dtsseJenkins.openPullRequest', (node) => open(target(node).prUrl)),
    vscode.commands.registerCommand('dtsseJenkins.openStatusBuild', () => statusBar.openBuild()),
    vscode.commands.registerCommand('dtsseJenkins.investigate', async (node) => {
      const failed = target(node).failedBuild;
      if (!failed) return;
      await investigate(
        {
          repo: failed.repo.name,
          jobName: failed.jobName,
          buildNumber: failed.build.number,
          buildUrl: failed.build.url,
        },
        workspace,
        jenkins,
      );
    }),
    vscode.commands.registerCommand('dtsseJenkins.signInToGitHub', async () => {
      if (await githubToken(true)) alerts.restart();
    }),
  );

  tree.schedule();
  statusBar.schedule();
  updateContext();
  void statusBar.update();
  void products.suggestFromEditor().then(updateContext);
  alerts.start();
}

export function deactivate(): void {}
