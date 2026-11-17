# HMCTS Template Preview

A VS Code extension that previews Docmosis `.docx` templates.

- Reads the template's instructions (fields, conditions, repeats and expressions) and infers the data it needs.
- Builds an input form from that: text and date inputs, checkboxes and repeat sections with add and remove row. Each input shows which `cs_`/`cr_` block it controls.
- Renders on the hosted [dtsse-doc-render](https://github.com/hmcts/dtsse-doc-render) service and shows the PDF beside the form. It re-renders 600 ms after you stop typing, and when the `.docx` changes on disk.
- Reports coverage: values the template uses that the data lacks, and data keys the template never uses.

It calls `docmosis render-file`, which sends the template and data to dtsse-doc-render; the service is reachable only over the VPN, so connect it first (if a render fails with "the VPN is probably down", it is not connected). The service implements a subset of the Docmosis template language (see its `docs/template-language.md`), so a successful preview is not proof that a template works in Docmosis. The `.vsix` bundles the CLI (`bin/docmosis`) and its template library (`lib/docx.mjs`) from this repo, so it works in any workspace; template parsing uses that library, so the extension and the CLI agree on what a template contains.

## Use

Right-click a `.docx` and choose **Open With... > HMCTS Template Preview**, or run **HMCTS Template Preview: Preview Docmosis template** for the open or selected `.docx`. The default `.docx` editor is not replaced.

Toolbar:

| Button | What it does |
|---|---|
| Render | Renders now. |
| Load data... | Merges a JSON file into the form. |
| Save data | Writes the form data to the sidecar file. |
| Dev mode | Passes `--dev` to `docmosis render-file`. |
| Open PDF | Saves the PDF beside the data and reveals it in the Explorer. |

Data is saved on every render at `<workspaceFolder>/.hmcts-template-preview/<template path>/default.json`, where `<template path>` is the template's path in the workspace without `.docx` (so `a/X.docx` and `b/X.docx` keep separate data). Data saved by earlier versions under `.hmcts-template-preview/<template name>/default.json` is loaded when the new file doesn't exist yet. The folder contains a `.gitignore` with `*`, so it is never committed. The form holds only the values you supplied; missing values aren't defaulted.

## Build and install

Download `hmcts-template-preview.vsix` from the [latest release](https://github.com/hmcts/dtsse-docmosis-tools/releases/latest) and run `code --install-extension hmcts-template-preview.vsix`.

To build it yourself (Node 20 or later and npm):

```sh
cd vscode
npm ci && npm run package
code --install-extension hmcts-template-preview.vsix
```

## Develop

```sh
npm ci
npm run watch      # rebuild on change
```

Open this folder in VS Code and press F5 to start an Extension Development Host, then open any `.docx`.

| Script | |
|---|---|
| `npm run build` | Type-check, then bundle `dist/extension.js` (node) and `dist/webview.js` (browser) with esbuild, and copy the pdf.js worker and the CLI (`../bin/docmosis`, `../lib/docx.mjs`) into `cli/`. |
| `npm test` | Unit tests (vitest). The library test uses `../lib/docx.mjs` unless `DOCMOSIS_LIB` names another. |
| `npm run test:integration` | Opens the editor in a real VS Code under `xvfb-run` with a fake CLI and `../lib/docx.mjs` (`@vscode/test-electron`; downloads VS Code on first run). |
| `npm run package` | Build, then write `hmcts-template-preview.vsix`. |

Source layout: `src/schema.ts` infers the schema from an instruction tree (pure); `src/templateTree.ts` is the only code that reads a `.docx`; `src/render.ts` runs the CLI and drops stale results; `src/webview/` is the form and PDF pane; `src/messages.ts` types the host and webview messages.

## Settings

| Setting | Default | |
|---|---|---|
| `hmctsTemplatePreview.docmosisCli` | empty | Path to the `docmosis` CLI; empty uses the CLI bundled with the extension. `${workspaceFolder}` is replaced by the workspace folder. The template library is loaded from `../lib/docx.mjs` relative to the script, as in a checkout of this repo. |

## Limits

- Names read inside a repeat are placed on the row, even when the template means a value from outside it.
- Dates whose input format has more than year, month and day (for example a time) get a text input showing the format.
- A two-argument `dateFormat(x, 'out')` names no input format, so `x` gets a text input and isn't checked before rendering.
- PDF text isn't selectable; pages are drawn to canvas.
