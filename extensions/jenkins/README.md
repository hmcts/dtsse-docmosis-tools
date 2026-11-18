# HMCTS Jenkins

VS Code extension for HMCTS CFT Jenkins pipelines. It runs in the cft-workspace: a workspace folder containing `workspace.yaml`.

- **Pipelines view** (activity bar): every team (workspace product), collapsed to start with. A team is labelled with its Jenkins view name when it has one and shows its repo count. Expand a team for its repos, then master, nightly master, other branches and pull requests, recent builds and their stages. A team's repos are only listed when it is expanded. Refreshes on a timer, paused while the view is hidden. Team context menu: Open in Jenkins (when it has a view) and Refresh.
- **Repo status**: the status bar shows the last master build of the repo you are editing.
- **PR alerts**: notifies when the Jenkins build of one of your open pull requests finishes or waits for input, with Open Build, Open PR and (on failure) Investigate with Claude. Not limited to a team. Only one VS Code window alerts at a time.
- **Investigate with Claude**: opens a terminal that runs `hai` (from `@hmcts-cft/hai-cli`) with a prompt describing the failed build.

Jenkins (`https://build.hmcts.net`) needs the VPN. The extension shows a "can't reach Jenkins" state rather than errors when it is down. PR alerts use GitHub's commit statuses, which work without the VPN; the failed stage and duration are added when Jenkins is reachable.

## Install

Download `dtsse-jenkins.vsix` from the CI run's artifacts, then run **Extensions: Install from VSIX...**, or `code --install-extension dtsse-jenkins.vsix`.

## Credentials

Jenkins uses basic auth with your username and an API token. The extension reads, in order:

1. Credentials stored by **HMCTS Jenkins: Set Credentials** in VS Code's secret storage.
2. `.claude/.jenkins.env` in the workspace folder, with literal `KEY=VALUE` lines (`#` comments and blank lines are skipped):

   ```
   JENKINS_URL=https://build.hmcts.net
   JENKINS_USERNAME=you@justice.gov.uk
   JENKINS_PASSWORD=<api token>
   ```

   `JENKINS_URL` is optional.

PR alerts sign in to GitHub through VS Code (`repo` scope) the first time you accept the prompt.

## Settings

| Setting                                   | Default         |                                                                                                                                           |
| ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `dtsseJenkins.productViews`               | `{}`            | Product to Jenkins view name, when they differ. Views are otherwise matched to the product name, ignoring case.                           |
| `dtsseJenkins.refreshSeconds`             | `60`            | Tree and status bar refresh interval.                                                                                                     |
| `dtsseJenkins.prAlerts.enabled`           | `true`          | Turn PR alerts on or off.                                                                                                                 |
| `dtsseJenkins.prAlerts.scope`             | `workspace`     | `workspace` alerts only for repos in `workspace.yaml`; `all` for every open PR you have in `hmcts`.                                       |
| `dtsseJenkins.investigate.command`        | `hai`           | Command that starts Claude; extra arguments such as `hai --bg` are split on whitespace.                                                   |
| `dtsseJenkins.investigate.promptTemplate` | see Settings UI | Placeholders: `{buildUrl} {repo} {clonePath} {pr} {branch} {commit} {failedStage}`. Clauses whose placeholders are all empty are dropped. |

## Commands

All are under **HMCTS Jenkins:** in the command palette.

| Command                                       |                                                |
| --------------------------------------------- | ---------------------------------------------- |
| Set Credentials                               | Store the Jenkins URL, username and API token. |
| Refresh                                       | Reload the tree and status bar.                |
| Open in Jenkins, Copy Link, Open Pull Request | On tree items.                                 |
| Investigate with Claude                       | On a failed build in the tree.                 |
| Sign in to GitHub                             | Enable PR alerts.                              |

## Develop

```
npm ci
npm run lint
npm run typecheck
npm test          # vitest; 100% coverage required on src/core
npm run package   # builds dist/extension.cjs and dtsse-jenkins.vsix
```

Logic lives in `src/core` (pure, no `vscode` import); `src/adapters` and `src/extension.ts` are thin VS Code wiring and are excluded from coverage.
