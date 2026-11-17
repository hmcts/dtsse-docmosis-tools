# dtsse-docmosis-tools

Tools for reading, editing, checking and rendering Docmosis `.docx` template files:

- `bin/docmosis`: a CLI that lists a template's fields and blocks, finds broken conditionals and repeats, unpacks a template to XML and packs it back, diffs two versions, and renders a template file on the hosted dtsse-doc-render.
- `lib/docx.mjs`: the template library the CLI uses, importable as an ES module.
- `vscode/`: HMCTS Template Preview, a VS Code extension that builds an input form from a template and renders it beside the form through the hosted dtsse-doc-render. See [vscode/README.md](vscode/README.md).

## Install

The CLI needs bash (3.2 or later) and Node 20 or later; rendering also needs `jq` and `curl`, and the VPN:

```sh
git clone git@github.com:hmcts/dtsse-docmosis-tools.git
export PATH="$PWD/dtsse-docmosis-tools/bin:$PATH"
docmosis --help
```

Or run `bin/docmosis` from the clone without changing `PATH`.

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
bin/docmosis render-file T.docx payload.json                          # T.pdf
bin/docmosis render-file T.docx payload.json --format docx --out out.docx
bin/docmosis render-file T.docx payload.json --dev                    # field errors rendered into the document
bin/docmosis text out.docx                                            # read the merged text
```

A failed render prints the service's message and exits 1. If the host can't be reached, the VPN is probably down.

### Limits

- It renders a subset of the Docmosis template language (see dtsse-doc-render's `docs/template-language.md`). A successful render is not proof that a template works in Docmosis.
- The request body is limited to 50 MB.
- `render-file` checks that the output is a real document before reporting success.

## Tests

The library tests need `zip` and `unzip`.

```sh
bash -n bin/docmosis
node --test test/*.test.mjs

cd vscode
npm ci
npm run build
npm test
npm run package    # writes hmcts-template-preview.vsix
```

Every push to master that changes `bin/`, `lib/` or `vscode/` publishes a GitHub release with the `.vsix`.
