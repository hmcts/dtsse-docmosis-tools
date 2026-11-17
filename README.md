# dtsse-docmosis-tools

Tools for reading, editing, checking and rendering Docmosis `.docx` template files:

- `bin/docmosis.mjs`: a CLI that lists a template's fields and blocks, finds broken conditionals and repeats, unpacks a template to XML and packs it back, diffs two versions, and renders a template file on the hosted dtsse-doc-render.
- `lib/docx.mjs` and `lib/render.mjs`: the template and render libraries the CLI uses, importable as ES modules from `@hmcts-cft/docmosis-tools`.
- `vscode/`: HMCTS Template Preview, a VS Code extension that builds an input form from a template and renders it beside the form through the hosted dtsse-doc-render. See [vscode/README.md](vscode/README.md).

## Install

The CLI needs Node 24 or later; rendering also needs the VPN. It is published to the HMCTS Azure Artifacts `hmcts-lib` feed as `@hmcts-cft/docmosis-tools`.

```sh
npm i -g @hmcts-cft/docmosis-tools --registry=https://pkgs.dev.azure.com/hmcts/Artifacts/_packaging/hmcts-lib/npm/registry/
docmosis --help
```

To install or run it without passing `--registry` each time, point the scope at the feed once:

```sh
npm config set @hmcts-cft:registry https://pkgs.dev.azure.com/hmcts/Artifacts/_packaging/hmcts-lib/npm/registry/
npx @hmcts-cft/docmosis-tools check Claim-Pack-V2.docx
```

Or run it from a clone, which needs no install:

```sh
git clone git@github.com:hmcts/dtsse-docmosis-tools.git
export PATH="$PWD/dtsse-docmosis-tools/bin:$PATH"
docmosis --help
```

### Use it as a library

```js
import { renderFile, RenderError, RenderUnreachable, check, fields } from '@hmcts-cft/docmosis-tools';

try {
  const { bytes } = await renderFile({ template: 'T.docx', data: { name: 'Ada' }, format: 'pdf' });
} catch (e) {
  if (e instanceof RenderUnreachable) console.error('VPN down?', e.message);
  else if (e instanceof RenderError) console.error(e.status, e.shortMsg, e.lines);
  else throw e;
}
```

`renderFile({ template, data, format = 'pdf', devMode = false, url = DOC_RENDER_URL, fetchImpl })` takes a template (bytes or a path) and data (an object or a JSON path), and resolves to `{ bytes, contentType, format }` after checking the output is a real document of that format. `@hmcts-cft/docmosis-tools/docx` and `@hmcts-cft/docmosis-tools/render` import each half alone.

The extension bundles the CLI, so it works in any workspace. Download `hmcts-template-preview.vsix` from the [latest release](https://github.com/hmcts/dtsse-docmosis-tools/releases/latest) and install it:

```sh
curl -fsSLO https://github.com/hmcts/dtsse-docmosis-tools/releases/latest/download/hmcts-template-preview.vsix
code --install-extension hmcts-template-preview.vsix
```

## Commands

```
Template files (no network):
  text <template>             the template's text, one paragraph per line
  fields <template>           the Docmosis instructions in document order, indented by block
  tree <template>             the instructions as a JSON tree, with the data names each reads
  check <template>            problems Docmosis rejects or mis-renders; exits 1 on errors
  diff <old> <new>            instructions and blocks added, removed and moved
  unpack <file.docx> <dir>    extract a template for editing
  pack <dir> <file.docx>      zip an unpacked folder back into a .docx

Rendering (dtsse-doc-render, VPN only):
  render-file <file.docx> <data.json> [--out file] [--format F] [--dev]
                              render a template file from your machine; F is pdf, docx, doc, odt, html or txt
```

`docmosis --help` has every option and example.

## Render a template file

`render-file` renders a template file on [dtsse-doc-render](https://github.com/hmcts/dtsse-doc-render): a hosted service in AAT that speaks Docmosis's render API without a Docmosis licence. It is at `https://doc-render.aat.platform.hmcts.net` (override with `DOC_RENDER_URL`) and is reachable only over the VPN. The template is sent with each request, so an edited file is never stale, and the service has no template store.

```sh
docmosis render-file T.docx payload.json                          # T.pdf
docmosis render-file T.docx payload.json --format docx --out out.docx
docmosis render-file T.docx payload.json --dev                    # field errors rendered into the document
docmosis text out.docx                                            # read the merged text
```

A failed render prints the service's message and exits 1. If the host can't be reached, the VPN is probably down.

### Limits

- It renders a subset of the Docmosis template language (see dtsse-doc-render's `docs/template-language.md`). A successful render is not proof that a template works in Docmosis.
- The request body is limited to 50 MB.
- `render-file` checks that the output is a real document before reporting success.

## Tests

The library tests need `zip` and `unzip`.

```sh
node --test test/*.test.mjs

cd vscode
npm ci
npm run build
npm test
npm run package    # writes hmcts-template-preview.vsix
```

Every push to master that changes `bin/`, `lib/` or `vscode/` publishes a GitHub release with the `.vsix` and dispatches `publish.yml` to publish it to the Marketplace and Open VSX. Every push that changes `bin/`, `lib/`, `index.*` or `package.json` also publishes the npm package to the `hmcts-lib` feed, patch-bumping past the versions already tagged.
