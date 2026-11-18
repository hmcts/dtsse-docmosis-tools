# @hmcts-cft/docmosis-tools

Tools for reading, editing, checking and rendering Docmosis `.docx` template files:

- `bin/docmosis.mjs`: a CLI that lists a template's fields and blocks, finds broken conditionals and repeats, unpacks a template to XML and packs it back, diffs two versions, and renders a template file on the hosted dtsse-doc-render.
- `lib/docx.mjs` and `lib/render.mjs`: the template and render libraries the CLI uses, importable as ES modules from `@hmcts-cft/docmosis-tools`.
- `lib/notify.mjs`, `lib/notify-products.mjs` and `lib/notify-node.mjs`: GOV.UK Notify template support (see [Notify](#notify)), used by the extension's Notify editor.
- `extensions/template-preview/`: HMCTS Template Preview, a VS Code extension that builds an input form from a template and renders it beside the form through the hosted dtsse-doc-render. See [extensions/template-preview/README.md](../../extensions/template-preview/README.md).

## Install

### Inside VS Code

Install the HMCTS Template Preview extension (see [extensions/template-preview/README.md](../../extensions/template-preview/README.md)). It puts the `docmosis` command on the PATH of VS Code's integrated terminals, with nothing else to install. The command uses your Node when that is 24 or later and VS Code's own Node otherwise. It appears in terminals opened after the extension activates, so reopen any terminal that was already open, and the `hmctsTemplatePreview.terminalCommand` setting turns it off.

### Outside VS Code

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
git clone git@github.com:hmcts/dtsse-ide-tooling.git
export PATH="$PWD/dtsse-ide-tooling/packages/docmosis-tools/bin:$PATH"
docmosis --help
```

### Use it as a library

```js
import { renderFile, RenderError, RenderUnreachable, check, fields } from '@hmcts-cft/docmosis-tools';

try {
  const { bytes } = await renderFile({ templatePath: 'T.docx', data: { name: 'Ada' }, format: 'pdf' });
} catch (e) {
  if (e instanceof RenderUnreachable) console.error('VPN down?', e.message);
  else if (e instanceof RenderError) console.error(e.status, e.shortMsg, e.lines);
  else throw e;
}
```

`renderFile({ template | templatePath, data | dataPath, format = 'pdf', devMode = false, url, signal, fetchImpl })` takes the template as bytes (`template`) or a .docx file (`templatePath`), and the data as an object (`data`) or a JSON file sent exactly as written (`dataPath`). The service is `url`, else `DOC_RENDER_URL` when set and not empty, else the AAT instance. It resolves to `{ bytes, contentType, format }` after checking the output is a real document of that format. `@hmcts-cft/docmosis-tools/docx` and `@hmcts-cft/docmosis-tools/render` import each half alone.

Node's `fetch` ignores `HTTPS_PROXY` and `NO_PROXY` and the system certificate store unless Node starts with `NODE_USE_ENV_PROXY=1` and `--use-system-ca`. The `docmosis` command always starts that way (`bin/docmosis` sets them, and `bin/docmosis.mjs` restarts Node with them when they are missing); a program that calls the library has to set them itself.

The extension bundles the library and the CLI, so it works in any workspace. Download `hmcts-template-preview.vsix` from the [latest release](https://github.com/hmcts/dtsse-ide-tooling/releases/latest) and install it:

```sh
curl -fsSLO https://github.com/hmcts/dtsse-ide-tooling/releases/latest/download/hmcts-template-preview.vsix
code --install-extension hmcts-template-preview.vsix
```

## Commands

```
Template files (no network):
  text <template>             the template's text, one paragraph per line
  fields <template>           the Docmosis instructions in document order, indented by block
  tree <template>             the instructions as a JSON tree, with the data names each reads
  schema <template>           the data the template expects, as JSON; see "Schema JSON"
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

## Schema JSON

`docmosis schema <docx>` prints what data a template expects, inferred from its instructions across every part (body, headers, footers). Other tools consume the output, so its shape is a contract. The package exports the same inference as `inferSchema(tree)` (also at `@hmcts-cft/docmosis-tools/schema`), which takes the nodes of `instructionTree` and returns an `InferResult`. `templateSchema(template)` does the whole job for what `readTemplate` returns, flattening every part's instructions first (`templateInstructions(template)` is that flattening, if you want to call `inferSchema` yourself). `inferSchema` also returns `refs`, `{ text, paths }[]`: for each instruction, the schema paths it reads (as `schemaPaths` writes them), so a tool can map an instruction to its fields. `docmosis schema` and `templateSchema` leave it out (they call `inferSchema(tree, { refs: false })`, which returns `refs` empty), so their output stays `{ root, warnings }`. A `refs` path can name an object or a list as well as a leaf: `cs_address` reads `address`.

```ts
type ScalarSchema = { kind: "string" | "boolean" | "date"; controls: string[]; notes: string[]; inputFormat?: string };
type ObjectSchema = { kind: "object"; controls: string[]; notes: string[]; properties: Record<string, Schema> };
type ArraySchema  = { kind: "array";  controls: string[]; notes: string[]; item: ObjectSchema };
type Schema = ScalarSchema | ObjectSchema | ArraySchema;
type InstructionRefs = { text: string; paths: string[] };
type InferResult = { root: ObjectSchema; warnings: string[]; refs: InstructionRefs[] };
// templateSchema returns Omit<InferResult, "refs">
```

- `root` is an object whose `properties` are the template's top-level names. A dotted name such as `claimant.name` becomes nested objects; `rs_` and `rr_` repeats become arrays, and what is read inside one is on `item`.
- A name read only as text is `string`; a name that is a bare condition (`cs_isEngland`) is `boolean`; a name passed to `dateFormat` is `date`, with `inputFormat` set when the template names the format it parses the stored value with.
- An index such as `items[0].x` reads an item of the list `items`. Every repeat, named or not (`rs_items.?[active]`), opens a scope as in dtsse-doc-render, and `$parent` is the scope around it; outside any repeat there is none, so a top-level `$parent.x` is ignored with a warning.
- A bare name inside a repeat is read from the current item only. A name can start with a scope prefix to read from another scope: `$root.x` is the top-level data, `$parent.x` is the repeat item (or the top level) around the current repeat, and `$this.x` is the current item, the same as the bare name. A prefix must stand alone: `$thisIsMine.x` and `$parentCase.x` are user variables, not prefixes.
- `dataRefs` (in `fields`, `tree` and the exported `dataRefs()`) keeps the prefix in the name string, so `<<$root.caseRef>>` has `dataRefs: ["$root.caseRef"]` and `<<name>>` inside a repeat has `["name"]`. The data payload has no prefixes: its keys are the name without the prefix, looked up in the scope the prefix picks. `$root.caseRef` is the top-level key `caseRef`, even inside a repeat; `$this.role` is the key `role` of the current item. A user variable such as `$myVar` or `$myVar.name` is not data, so it appears in no `dataRefs`.
- A repeat over something the schema can't place (a `$variable`, `$this`, `$parent` outside any repeat, or a name already used as an object) is not modelled. The names read inside it, including those of repeats nested in it, are left out of the schema and one warning lists them. A repeat over an indexed element such as `rs_items[0]` iterates a list inside a list, which the schema doesn't model either; it marks `items` as a list and gets one warning saying so, and the names read inside it are left out and not listed. A name indexed where there is no list (`$this[0]`, `$parent[0]`) is ignored with a warning that names the repeat it sits in. A bare `$root`, a bare `$parent`, or a bare `$this` outside any repeat names a whole scope rather than a field, and is ignored with a warning.
- `controls` lists the blocks (for example `cs_isEngland`) whose condition reads the value. `notes` holds remarks such as that the template only tests a value for blank or null.
- `warnings` lists names used in conflicting ways (for example as both a date and a boolean); the schema keeps the widened or dominant kind.
- Instruction text is read for names only; expressions are not evaluated, so a name used in arithmetic or a function other than `dateFormat` and `isBlank` is reported as `string`.

```json
{
  "root": {
    "kind": "object", "controls": [], "notes": [],
    "properties": {
      "isEngland": { "kind": "boolean", "controls": ["cs_isEngland"], "notes": [] },
      "issueDate": { "kind": "date", "controls": [], "notes": [], "inputFormat": "yyyy-MM-dd" },
      "items": { "kind": "array", "controls": [], "notes": [], "item": { "kind": "object", "controls": [], "notes": [], "properties": { "label": { "kind": "string", "controls": [], "notes": [] } } } }
    }
  },
  "warnings": []
}
```

## Notify

Three exports hold the GOV.UK Notify template support behind the extension's Notify editor. The CLI doesn't use them, and `@hmcts-cft/docmosis-tools` itself doesn't re-export them.

`@hmcts-cft/docmosis-tools/notify` is pure, with no Node built-ins, so a browser bundle can import it:

- `findPlaceholders(...texts)` finds the `((name))` and `((name??text))` placeholders, matching names as Notify does (ignoring case, spaces, underscores and hyphens; `placeholderKey`). `personalisationSchema(placeholders)` returns an `ObjectSchema` in the [Schema JSON](#schema-json) shape: a `string` per placeholder and a `boolean` per conditional. `lookup`, `dataKey`, `isYes`, `formValues` and `apiPersonalisation` read data the way Notify does; `apiPersonalisation` sends each empty placeholder as `((name))`, because Notify refuses a preview with one missing.
- `renderLocal(type, subject, body, data)` is an approximate preview: email and letter bodies as HTML from Notify's markdown (`notifyMarkdown`), text messages as text with `smsCount`'s characters, fragments and whether the message is Unicode. Notify's own preview is authoritative.
- The API's types (`NotifyTemplate`, `NotifyPreview`, `TemplateType`, `Personalisation`) and `templateAdminUrl(serviceId, templateId)`, the template's page in the Notify web app.

`@hmcts-cft/docmosis-tools/notify/products` is pure too, and kept apart so a bundle that only previews templates doesn't carry the vault and secret names:

- `BUILT_IN_PRODUCTS`: each product's Notify API key as the service mounts it from its AAT Key Vault (`{ id, label, vault, secret, note? }`, type `NotifyProduct`). `mergeProducts(entries)` adds entries or replaces built-in ones by `id`, sorted by label, and drops any whose `id`, `vault` or `secret` isn't letters, digits and hyphens (`SAFE_NAME`).

`@hmcts-cft/docmosis-tools/notify/node` needs Node:

- `new NotifyClient(apiKey, { baseUrl, fetchImpl })` lists (`listTemplates(type?)`), reads (`getTemplate(id)`) and previews (`previewTemplate(id, personalisation, signal?)`) templates, and can't change them. It signs each request with the key (`parseApiKey`, `signToken`). It uses `baseUrl` when given, else the public API. A refusal throws `NotifyApiError` with `status` and Notify's `errors`.
- `readSecret(vault, secret)` reads a key with `az keyvault secret show` under the user's own `az login`, without a shell, and throws `KeyVaultError` with a message to show a person (not signed in, no access, no such secret, `az` missing). `KeyStore` keeps the keys read in memory for the session and drops a failed read.

```js
import { findPlaceholders, apiPersonalisation } from '@hmcts-cft/docmosis-tools/notify';
import { KeyStore, NotifyClient } from '@hmcts-cft/docmosis-tools/notify/node';

const client = new NotifyClient(await new KeyStore().get('pcs-aat', 'gov-notify-key'));
const template = await client.getTemplate(templateId);
const { personalisation, missing } = apiPersonalisation(findPlaceholders(template.subject, template.body), data);
const preview = await client.previewTemplate(template.id, personalisation);
```

## Tests

The library tests need `zip` and `unzip`.

```sh
npm ci            # at the repository root
npm test --workspace packages/docmosis-tools

npm run build --workspace extensions/template-preview
npm test --workspace extensions/template-preview
npm run package --workspace extensions/template-preview    # writes extensions/template-preview/hmcts-template-preview.vsix
```

Every push to master that changes `packages/docmosis-tools/` or `extensions/template-preview/` publishes a GitHub release with the `.vsix` and dispatches `publish.yml` to publish it to the Marketplace and Open VSX. Every push that changes `packages/docmosis-tools/` also publishes the npm package to the `hmcts-lib` feed, patch-bumping past the versions already tagged `npm-v<version>`. Extension releases are tagged `vscode-v0.1.<run number>`.
