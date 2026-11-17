# Publishing

The release workflow (`.github/workflows/release.yml`) builds `0.1.<run number>`, creates the GitHub release, then publishes the same `.vsix` to the Visual Studio Marketplace and Open VSX. Each target is skipped, with a log line, until its credential below is set.

## Visual Studio Marketplace

- Publisher `hmcts` at <https://marketplace.visualstudio.com/manage>, with the owners listed.
- One credential, either:
  - Secret `VSCE_PAT`: an Azure DevOps personal access token, organisation "All accessible organizations", scope Marketplace → Manage, created by a publisher member.
  - Entra federated credentials, used when `VSCE_PAT` is not set:
    - An app registration whose service principal is added as a member of the `hmcts` publisher.
    - A federated credential on it with issuer `https://token.actions.githubusercontent.com` and the subject GitHub issues for `hmcts/dtsse-docmosis-tools` pushes to `master`.
    - Repository variables `VSCE_AZURE_CLIENT_ID`, `VSCE_AZURE_TENANT_ID` and `VSCE_AZURE_SUBSCRIPTION_ID`.
- Unverified publisher: users see a one-time 'trust this publisher' prompt on first install.

## Open VSX (optional)

- An Eclipse account with the Open VSX publisher agreement signed.
- Namespace `hmcts`, created with `npx ovsx create-namespace hmcts -p <token>`.
- Secret `OVSX_PAT`: an access token from <https://open-vsx.org/user-settings/tokens>.
