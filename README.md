# dtsse-docmosis-tools

Tools for reading, editing, checking and rendering the Docmosis `.docx` templates in [hmcts/rdo-docmosis](https://github.com/hmcts/rdo-docmosis):

- `bin/docmosis`: a CLI that lists a template's fields and blocks, finds broken conditionals and repeats, unpacks a template to XML and packs it back, diffs two versions, and renders a template on a local Docmosis in Docker, on AAT or on a hmcts/docmosis preview PR.
- `lib/docx.mjs`: the template library the CLI uses, importable as an ES module.
- `vscode/`: HMCTS Template Preview, a VS Code extension that builds an input form from a template and renders it beside the form through a local Docmosis. See [vscode/README.md](vscode/README.md).

The detailed how-to is [Edit a Docmosis template](https://github.com/hmcts/cft-workspace/blob/master/docs/how-to/edit-a-docmosis-template.md) in cft-workspace.

## Install

The CLI needs bash (3.2 or later) and Node 20 or later; rendering also needs `jq` and `curl`, and `kubectl` for the preview PR options:

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

Docmosis instance (AAT by default, or --preview <n>, --url, --port-forward):
  status | probe              check the instance answers; which REST endpoints it offers
  structure <template-name>   the instance's view of a stored template's fields
  sample <template-name>      the instance's placeholder data for a stored template
  render <template-name> <data.json> [--out file] [--dev] [--format pdf|docx]
  put <ns>/<pod-or-release> <file.docx>
                              copy a template into a hmcts/docmosis preview PR pod

Local Docmosis (Docker):
  local start | status | stop
  local render <file.docx> <data.json> [--out file] [--dev] [--format pdf|docx]
```

`docmosis --help` has every option and example.

## Local Docmosis

`docmosis local` runs the image every environment runs, `hmctsprod.azurecr.io/docmosis/docmosis-unified:latest`, on `127.0.0.1:18087`. It needs:

- Docker.
- An `az` login that can pull from `hmctsprod` and has Get on Key Vault `dtsse-aat` secret `docmosis-tornado-trial-key`, the licence key. The key is rotated monthly: after a rotation, run `docmosis local stop` then `docmosis local start`.

The CLI reads the licence and access keys itself and never prints them.

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
