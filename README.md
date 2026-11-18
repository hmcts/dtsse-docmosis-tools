# dtsse-ide-tooling

Tooling for HMCTS template authors, as an npm workspaces monorepo.

| Path | What it is |
|---|---|
| [`packages/docmosis-tools`](packages/docmosis-tools) | `@hmcts-cft/docmosis-tools`: the `docmosis` CLI and library for reading, checking, editing and rendering Docmosis `.docx` templates. Published to the `hmcts-lib` feed. |
| [`packages/notify-tools`](packages/notify-tools) | `@hmcts-cft/notify-tools`: GOV.UK Notify template support: placeholders, an approximate local preview and a read-only API client. Published to the `hmcts-lib` feed. |
| [`extensions/template-preview`](extensions/template-preview) | HMCTS Template Preview, a VS Code extension that previews Docmosis templates. Published to the Marketplace. |
| [`extensions/notify`](extensions/notify) | GOV.UK Notify Templates, a VS Code extension that browses, previews and drafts changes to GOV.UK Notify templates. Published to the Marketplace. |

## Build and test

Node 24 or later.

```sh
npm ci
npm test                                               # library and extension tests
npm run build --workspace extensions/template-preview
npm run package                                        # a .vsix in each extension directory
```

Release and publishing are described in each package's README and in [`extensions/template-preview/PUBLISHING.md`](extensions/template-preview/PUBLISHING.md).
