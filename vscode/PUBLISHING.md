# Publishing

The release workflow (`.github/workflows/release.yml`) builds `0.1.<run number>`, creates the GitHub release and dispatches `.github/workflows/publish.yml` for its tag. That workflow downloads the release's `hmcts-template-preview.vsix` and publishes it to the Visual Studio Marketplace with trusted publishing (OIDC), so no token is stored. It can also be run by hand with a `tag`, and runs on a release published by hand.

## Visual Studio Marketplace

- Publisher `hmcts` at <https://marketplace.visualstudio.com/manage>, with the owners listed.
- Trusted publisher registered on the extension `hmcts.hmcts-template-preview`: repository `hmcts/dtsse-docmosis-tools`, workflow `publish.yml`, no environment.
- The repository name in the registration must be exactly `hmcts/dtsse-docmosis-tools`. A re-run for a tag that is already published is skipped as a duplicate.
- Unverified publisher: users see a one-time 'trust this publisher' prompt on first install.

## Open VSX (optional)

- An Eclipse account with the Open VSX publisher agreement signed.
- Namespace `hmcts`, created with `npx ovsx create-namespace hmcts -p <token>`.
- Secret `OVSX_PAT`: an access token from <https://open-vsx.org/user-settings/tokens>. Without it the step is skipped with a log line.
