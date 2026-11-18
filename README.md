# dtsse-ide-tooling

Tooling for HMCTS template authors, as an npm workspaces monorepo.

| Path | What it is |
|---|---|
| [`packages/docmosis-tools`](packages/docmosis-tools) | `@hmcts-cft/docmosis-tools`: the `docmosis` CLI and library for reading, checking, editing and rendering Docmosis `.docx` templates, plus GOV.UK Notify template support. Published to the `hmcts-lib` feed. |
| [`extensions/template-preview`](extensions/template-preview) | HMCTS Template Preview, a VS Code extension that previews Docmosis templates and edits GOV.UK Notify templates. Published to the Marketplace. |

## Build and test

Node 24 or later.

```sh
npm ci
npm test                                               # library and extension tests
npm run build --workspace extensions/template-preview
npm run package                                        # extensions/template-preview/hmcts-template-preview.vsix
```

Release and publishing are described in each package's README and in [`extensions/template-preview/PUBLISHING.md`](extensions/template-preview/PUBLISHING.md).
