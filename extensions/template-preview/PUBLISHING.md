# Publishing

Three extensions are published from this repository, each by its own release workflow run:

| Extension | Id | Directory | Release tag | Release asset |
|---|---|---|---|---|
| HMCTS Template Preview | `hmcts.hmcts-template-preview` | `extensions/template-preview` | `vscode-v0.1.<run number>` | `hmcts-template-preview.vsix` |
| GOV.UK Notify Templates | `hmcts.hmcts-notify` | `extensions/notify` | `notify-vscode-v0.1.<run number>` | `hmcts-notify.vsix` |
| HMCTS Jenkins | `hmcts.dtsse-jenkins` | `extensions/jenkins` | `jenkins-vscode-v0.1.<run number>` | `dtsse-jenkins.vsix` |

The release workflow (`.github/workflows/release.yml`) releases each extension when its own files, its package dependency or the root `package.json` / `package-lock.json` change. It builds `0.1.<run number>`, creates the GitHub release and dispatches `.github/workflows/publish.yml` for the tag. `publish.yml` takes the extension directory and vsix name from the tag prefix (`vscode-v`, `notify-vscode-v` or `jenkins-vscode-v`), downloads the release's vsix and publishes it to the Visual Studio Marketplace with trusted publishing (OIDC), so no token is stored. It can also be run by hand with a `tag`, and runs on a release published by hand. An unknown tag prefix fails the run.

## Visual Studio Marketplace

- Publisher `hmcts` at <https://marketplace.visualstudio.com/manage>, with the owners listed.
- Trusted publisher registered on the `hmcts` publisher: repository `hmcts/dtsse-ide-tooling`, workflow `publish.yml`, no environment. It covers every extension in the publisher, and the first publish of a new extension creates it.
- The repository name in the registration must be exactly `hmcts/dtsse-ide-tooling`. A re-run for a tag that is already published is skipped as a duplicate.
- Unverified publisher: users see a one-time 'trust this publisher' prompt on first install.

## Open VSX (optional)

- An Eclipse account with the Open VSX publisher agreement signed.
- Namespace `hmcts`, created with `npx ovsx create-namespace hmcts -p <token>`.
- Secret `OVSX_PAT`: an access token from <https://open-vsx.org/user-settings/tokens>. Without it the step is skipped with a log line.
