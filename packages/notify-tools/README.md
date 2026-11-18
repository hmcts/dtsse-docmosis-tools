# @hmcts-cft/notify-tools

GOV.UK Notify template support: the `((placeholders))` a template reads, an approximate local preview, and a read-only API client. It is the library behind the GOV.UK Notify Templates VS Code extension (`extensions/notify`). Published to the HMCTS Azure Artifacts `hmcts-lib` feed, and needs Node 24 or later.

```sh
npm config set @hmcts-cft:registry https://pkgs.dev.azure.com/hmcts/Artifacts/_packaging/hmcts-lib/npm/registry/
npm i @hmcts-cft/notify-tools
```

`@hmcts-cft/notify-tools` is pure, with no Node built-ins, so a browser bundle can import it:

- `findPlaceholders(...texts)` finds the `((name))` and `((name??text))` placeholders, matching names as Notify does (ignoring case, spaces, underscores and hyphens; `placeholderKey`). `personalisationSchema(placeholders)` returns a form schema: a `string` per placeholder and a `boolean` per conditional. `lookup`, `dataKey`, `isYes`, `formValues` and `apiPersonalisation` read data the way Notify does; `apiPersonalisation` sends each empty placeholder as `((name))`, because Notify refuses a preview with one missing.
- `renderLocal(type, subject, body, data)` is an approximate preview: email and letter bodies as HTML from Notify's markdown (`notifyMarkdown`), text messages as text with `smsCount`'s characters, fragments and whether the message is Unicode. Notify's own preview is authoritative.
- The API's types (`NotifyTemplate`, `NotifyPreview`, `TemplateType`, `Personalisation`) and `templateAdminUrl(serviceId, templateId)`, the template's page in the Notify web app.

`@hmcts-cft/notify-tools/products` is pure too, and kept apart so a bundle that only previews templates doesn't carry the vault and secret names:

- `BUILT_IN_PRODUCTS`: each product's Notify API key as the service mounts it from its AAT Key Vault (`{ id, label, vault, secret, note? }`, type `NotifyProduct`). `mergeProducts(entries)` adds entries or replaces built-in ones by `id`, sorted by label, and drops any whose `id`, `vault` or `secret` isn't letters, digits and hyphens (`SAFE_NAME`).

`@hmcts-cft/notify-tools/node` needs Node:

- `new NotifyClient(apiKey, { baseUrl, fetchImpl })` lists (`listTemplates(type?)`), reads (`getTemplate(id)`) and previews (`previewTemplate(id, personalisation, signal?)`) templates, and can't change them. It signs each request with the key (`parseApiKey`, `signToken`). It uses `baseUrl` when given, else the public API. A refusal throws `NotifyApiError` with `status` and Notify's `errors`.
- `readSecret(vault, secret)` reads a key with `az keyvault secret show` under the user's own `az login`, without a shell, and throws `KeyVaultError` with a message to show a person (not signed in, no access, no such secret, `az` missing). `KeyStore` keeps the keys read in memory for the session and drops a failed read.

```js
import { findPlaceholders, apiPersonalisation } from '@hmcts-cft/notify-tools';
import { KeyStore, NotifyClient } from '@hmcts-cft/notify-tools/node';
import { BUILT_IN_PRODUCTS } from '@hmcts-cft/notify-tools/products';

const pcs = BUILT_IN_PRODUCTS.find((p) => p.id === 'pcs');
const client = new NotifyClient(await new KeyStore().get(pcs.vault, pcs.secret));
const template = await client.getTemplate(templateId);
const { personalisation, missing } = apiPersonalisation(findPlaceholders(template.subject, template.body), data);
const preview = await client.previewTemplate(template.id, personalisation);
```

## Tests

```sh
npm ci            # at the repository root
npm test --workspace packages/notify-tools
```
