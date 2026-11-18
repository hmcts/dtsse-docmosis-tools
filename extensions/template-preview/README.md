# HMCTS Template Preview

A VS Code extension that previews Docmosis `.docx` templates, and browses, previews and drafts changes to [GOV.UK Notify templates](#govuk-notify-templates).

- Reads the template's instructions (fields, conditions, repeats and expressions) and infers the data it needs.
- Builds an input form from that: text and date inputs, checkboxes and repeat sections with add and remove row. Each input shows which `cs_`/`cr_` block it controls.
- Renders on the hosted [dtsse-doc-render](https://github.com/hmcts/dtsse-doc-render) service and shows the PDF beside the form. It re-renders 600 ms after you stop typing, and when the `.docx` changes on disk.
- Reports coverage: values the template uses that the data lacks, and data keys the template never uses.

It sends the template and data to dtsse-doc-render, which is reachable only over the VPN, so connect it first (a render that fails with "Can't reach dtsse-doc-render: is the VPN connected?" means it is not). Set `DOC_RENDER_URL` in the environment VS Code starts in to use another instance. Proxies and certificates come from VS Code's `http.proxy`, `http.proxySupport` and `http.fetchAdditionalSupport` settings, which patch `fetch` in the extension host. The service implements a subset of the Docmosis template language (see its `docs/template-language.md`), so a successful preview is not proof that a template works in Docmosis. The extension bundles the `@hmcts-cft/docmosis-tools` library, which the `docmosis` CLI also uses, so it works in any workspace and the two agree on what a template contains.

## Use

Right-click a `.docx` and choose **Open With... > HMCTS Template Preview**, or run **HMCTS Template Preview: Preview Docmosis template** for the open or selected `.docx`. The default `.docx` editor is not replaced.

Toolbar:

| Button | What it does |
|---|---|
| Render | Renders now. |
| Load data... | Merges a JSON file into the form. |
| Save data | Writes the form data to the sidecar file. |
| Dev mode | Renders field errors into the document instead of failing (the service's `devMode`). |
| Open PDF | Saves the PDF beside the data and reveals it in the Explorer. |

Data is saved on every render at `<workspaceFolder>/.hmcts-template-preview/<template path>/default.json`, where `<template path>` is the template's path in the workspace without `.docx` (so `a/X.docx` and `b/X.docx` keep separate data). Data saved by earlier versions under `.hmcts-template-preview/<template name>/default.json` is loaded when the new file doesn't exist yet. The folder contains a `.gitignore` with `*`, so it is never committed. The form holds only the values you supplied; missing values aren't defaulted.

## The Templates view

The **HMCTS Templates** icon in the Activity Bar opens a **Templates** view that lists the `.docx` templates in one or more GitHub repositories. The repositories don't need to be cloned. Click a template to open it in the preview. **Search templates** (the search button in the view's title bar, or the command palette) searches every template by file name and folder. You can also type in the view to filter it.

By default the view lists the `Templates/` folder of [hmcts/rdo-docmosis](https://github.com/hmcts/rdo-docmosis), so it works with no configuration. To list other repositories, set `hmctsTemplatePreview.templateLibraries`, usually in the workspace settings of the workspace that uses them. The setting replaces the default rather than adding to it, so include the hmcts/rdo-docmosis entry to keep it alongside the others:

```json
"hmctsTemplatePreview.templateLibraries": [
  { "repo": "hmcts/rdo-docmosis", "path": "Templates" },
  { "repo": "acme/letters", "path": "templates", "label": "Letters" },
  { "repo": "acme/orders", "ref": "release" }
]
```

Set it to `[]` to list no repositories. Remove the setting to go back to the default.

| Key | |
|---|---|
| `repo` | The repository, as `owner/name`. Required. |
| `ref` | Branch, tag or commit. Defaults to the repository's default branch. |
| `path` | Folder to list. Defaults to the whole repository. |
| `label` | Name shown for the library when there are several. |

The same repository can be listed more than once at different refs or folders. Owner and repository names are matched without regard to case, as GitHub does; refs and folders are case-sensitive. An entry that repeats an earlier one (same repository, ref and folder) is ignored and reported in the **HMCTS Template Preview** output channel.

The view uses your VS Code GitHub sign-in, or the GitHub CLI's login (`gh auth login`) if VS Code has none. If GitHub rejects one of these tokens, the view tries the other before it shows a **Sign in to GitHub** button. For a repository in an organisation that uses SAML single sign-on, the token must be authorised for that organisation; the error message links to the page that does this.

The file list is saved, so the view shows it at once and checks GitHub in the background for changes when it opens, at most every 5 minutes. A check that finds no change doesn't count against GitHub's rate limit. **Refresh** checks now. Opening a template also checks its library when the last check is more than 5 minutes old, without waiting for the check. A template is downloaded the first time you open it, and again only when its content changes, including when that check finds a newer version of a template you just opened. Downloads are kept in the extension's global storage under `libraries/<owner>/<repo>/<ref>/<path in the repo>`, where `<ref>` is `default` for the default branch and otherwise the ref's name made safe for a file name, plus a short hash of it. Each version of a template from one ref is downloaded to the same path, so a preview that is open reloads when a newer version arrives and keeps its saved data, and libraries on the same repository at different refs keep separate copies. Changes you make to a downloaded copy are overwritten when a newer version is downloaded.

## GOV.UK Notify templates

Notify templates can only be changed in the Notify web app: its API lists, reads and previews them, but can't write them. The extension adds a **GOV.UK Notify** icon to the activity bar for trying personalisation against a product's templates and drafting a change before you paste it into Notify.

1. Click the icon and choose a product. The extension reads that product's Notify API key from its AAT Key Vault with your own `az` login, and keeps it in memory for the session only. It is never written to disk.
2. Choose a template from the dropdown, which groups them into email, text message and letter and can be filtered by name, then click **Open** or press Enter. The template opens in an editor tab.
3. **View** mode shows a personalisation form beside Notify's own preview. The preview updates 600 ms after you stop typing. A placeholder you leave empty is sent as `((name))`, because Notify refuses a preview with personalisation missing.
4. **Edit** mode adds subject and body boxes above the form. Fields are added to the form as you add placeholders. The preview is rendered locally and is approximate: Notify's own preview is authoritative.
5. To publish a draft, use **Copy subject** and **Copy body**, then **Open in Notify** and paste them into the template there. **Show diff** compares the draft with Notify's version, and **Revert to Notify version** discards the draft.

You need the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), `az login` done, and read access to secrets in the product's AAT vault. The VPN isn't needed: Key Vault and the Notify API are public. If you have no access to a vault, the side view says "Forbidden" and names the vault. Run **HMCTS Template Preview: Forget GOV.UK Notify API keys** to drop the keys held in memory, for example after being granted access or switching `az` account.

Placeholders are matched to data the way Notify matches them, ignoring case, spaces, underscores and hyphens. A `((name??text))` conditional gets a checkbox, sent to Notify as `yes` or `no`. A list value loaded from a JSON file shows as bullets in emails and letters.

Each template's form data is saved at `.hmcts-template-preview/notify/<product>/<template id>/default.json` and its draft at `draft.json`, beside the Docmosis data and likewise never committed. The draft records the Notify version it was started from, and a banner warns when Notify's template has changed since.

The products, with the vault and secret of each, are built in (`BUILT_IN_PRODUCTS` in the package's `lib/notify-products.mjs`). Add a product, or replace a built-in one by its `id`, with the `hmctsTemplatePreview.notify.products` setting:

```json
"hmctsTemplatePreview.notify.products": [
  { "id": "civil-live", "label": "Civil (live key)", "vault": "civil-aat", "secret": "gov-notify-api-key" }
]
```

Set `HMCTS_TEMPLATE_PREVIEW_NOTIFY_URL` in the environment VS Code starts in to use another Notify API, such as a local stub. The side view then names that API in its status line.

## The docmosis command in the terminal

The extension also provides the `docmosis` command (the [CLI](../../packages/docmosis-tools/README.md#commands): `text`, `fields`, `check`, `diff`, `unpack`, `pack`, `render-file`) in VS Code's integrated terminals, with no separate install. It is added to the terminal's `PATH` when the extension activates, so it appears in terminals opened after that: close and reopen a terminal that was already open. It runs on your `node` when that is version 24 or later, and on VS Code's own Node otherwise.

Set `hmctsTemplatePreview.terminalCommand` to `false` to stop adding it. Outside VS Code, install `@hmcts-cft/docmosis-tools` from the hmcts-lib feed instead (see the [library README](../../packages/docmosis-tools/README.md#install)).

## Install

- **Marketplace:** search for "HMCTS Template Preview" (publisher `hmcts`) in the Extensions view, or run `code --install-extension hmcts.hmcts-template-preview`. Open VSX, for VS Code forks, carries the same id once it is published there. The `hmcts` publisher is unverified, so VS Code asks once to trust it on first install.
- **GitHub release:** download `hmcts-template-preview.vsix` from the [latest release](https://github.com/hmcts/dtsse-ide-tooling/releases/latest) and run `code --install-extension hmcts-template-preview.vsix`. Releases are tagged `vscode-v0.1.<run number>`.
- **Devcontainer:** the cft-workspace devcontainer runs `.devcontainer/install-template-preview.sh` on attach, which installs the latest release's `.vsix` into the attached VS Code and updates it when a newer release appears.

To build it yourself (Node 24 or later and npm):

```sh
npm ci
cd extensions/template-preview && npm run package
code --install-extension hmcts-template-preview.vsix
```

Maintainers: [PUBLISHING.md](PUBLISHING.md) lists what the Marketplace and Open VSX publishing needs.

## Develop

```sh
npm ci          # at the repository root
cd extensions/template-preview
npm run watch      # rebuild on change
```

Open this folder in VS Code and press F5 to start an Extension Development Host, then open any `.docx`.

| Script | |
|---|---|
| `npm run build` | Type-check, then bundle `dist/extension.js` (node), the `dist/webview.js`, `dist/notify-picker.js` and `dist/notify-editor.js` webviews (browser) and the CLI (`dist/cli/docmosis-cli.mjs`, with the `docmosis` and `docmosis.cmd` launchers from `cli/`) with esbuild, and copy the pdf.js worker. |
| `npm test` | Unit tests (vitest). `RENDER_LIVE_TEMPLATE=<file.docx> npm test` also renders that template on the real dtsse-doc-render (VPN). |
| `npm run test:integration` | Opens the Docmosis preview and a Notify template in a real VS Code under `xvfb-run`, with local stand-ins for dtsse-doc-render, the Notify API and `az` (`@vscode/test-electron`; downloads VS Code on first run). |
| `npm run package` | Build, then write `hmcts-template-preview.vsix`. |

Source layout: `src/schema.ts` infers the schema from an instruction tree (pure); `src/templateTree.ts` is the only code that reads a `.docx`; `src/render.ts` calls `renderFile` and drops stale results; `src/webview/` is the form and PDF pane; `src/messages.ts` types the host and webview messages; `src/webviewHtml.ts` builds the pages' HTML and CSP; `src/library/` is the Templates view, where only `view.ts` uses the VS Code API.

Notify: the package's `lib/notify-products.mjs` holds the product table, `lib/notify.mjs` finds `((placeholders))`, builds the form's schema and makes the approximate Edit preview, and `lib/notify-node.mjs` reads keys with `az` and signs requests to the Notify API; in `src/notify/`, `sidebar.ts` is the side view and `panel.ts` the editor tab, with `service.ts` sharing keys and template lists between them; `storage.ts` saves data and drafts; `messages.ts` types their messages; `webview/` holds the two webviews.

## Limits

- Names read inside a repeat are placed on the row, even when the template means a value from outside it.
- Dates whose input format has more than year, month and day (for example a time) get a text input showing the format.
- A two-argument `dateFormat(x, 'out')` names no input format, so `x` gets a text input and isn't checked before rendering.
- PDF text isn't selectable; pages are drawn to canvas.
