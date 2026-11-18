# GOV.UK Notify Templates

A VS Code extension that browses, previews and drafts changes to [GOV.UK Notify](https://www.notifications.service.gov.uk) templates. It split out of HMCTS Template Preview. The chosen product is remembered per extension, so choose it again once; keys are read from Key Vault and never stored.

Notify templates can only be changed in the Notify web app: its API lists, reads and previews them, but can't write them. The **GOV.UK Notify** icon in the activity bar opens a view for trying personalisation against a product's templates and drafting a change before you paste it into Notify.

1. Click the icon and choose a product. The extension reads that product's Notify API key from its AAT Key Vault with your own `az` login, and keeps it in memory for the session only. It is never written to disk.
2. Choose a template from the dropdown, which groups them into email, text message and letter and can be filtered by name, then click **Open** or press Enter. The template opens in an editor tab.
3. **View** mode shows a personalisation form beside Notify's own preview. The preview updates 600 ms after you stop typing. A placeholder you leave empty is sent as `((name))`, because Notify refuses a preview with personalisation missing.
4. **Edit** mode adds subject and body boxes above the form. Fields are added to the form as you add placeholders. The preview is rendered locally and is approximate: Notify's own preview is authoritative.
5. To publish a draft, use **Copy subject** and **Copy body**, then **Open in Notify** and paste them into the template there. **Show diff** compares the draft with Notify's version, and **Revert to Notify version** discards the draft.

You need the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), `az login` done, and read access to secrets in the product's AAT vault. The VPN isn't needed: Key Vault and the Notify API are public. If you have no access to a vault, the side view says "Forbidden" and names the vault. Run **GOV.UK Notify Templates: Forget GOV.UK Notify API keys** to drop the keys held in memory, for example after being granted access or switching `az` account.

Placeholders are matched to data the way Notify matches them, ignoring case, spaces, underscores and hyphens. A `((name??text))` conditional gets a checkbox, sent to Notify as `yes` or `no`. A list value loaded from a JSON file shows as bullets in emails and letters.

Each template's form data is saved at `.hmcts-template-preview/notify/<product>/<template id>/default.json` and its draft at `draft.json`, beside the Docmosis data and likewise never committed. The draft records the Notify version it was started from, and a banner warns when Notify's template has changed since.

The products, with the vault and secret of each, are built in (`BUILT_IN_PRODUCTS` in `@hmcts-cft/notify-tools`, `packages/notify-tools/lib/products.mjs`). Add a product, or replace a built-in one by its `id`, with the `hmctsNotify.products` setting:

```json
"hmctsNotify.products": [
  { "id": "civil-live", "label": "Civil (live key)", "vault": "civil-aat", "secret": "gov-notify-api-key" }
]
```

Set `HMCTS_NOTIFY_URL` in the environment VS Code starts in to use another Notify API, such as a local stub. The side view then names that API in its status line.

## Install

- **Marketplace:** search for "GOV.UK Notify Templates" (publisher `hmcts`), or run `code --install-extension hmcts.hmcts-notify`.
- **GitHub release:** download `hmcts-notify.vsix` from the [releases](https://github.com/hmcts/dtsse-ide-tooling/releases) tagged `notify-vscode-v0.1.<run number>` and run `code --install-extension hmcts-notify.vsix`.

To build it yourself (Node 24 or later and npm):

```sh
npm ci            # at the repository root
cd extensions/notify && npm run package
code --install-extension hmcts-notify.vsix
```

Maintainers: [PUBLISHING.md](../template-preview/PUBLISHING.md) covers publishing both extensions.

## Develop

| Script | |
|---|---|
| `npm run build` | Type-check, then bundle `dist/extension.js` (node) and the `dist/notify-picker.js` and `dist/notify-editor.js` webviews (browser) with esbuild. |
| `npm test` | Unit tests (vitest). |
| `npm run test:integration` | Opens a Notify template in a real VS Code under `xvfb-run`, with local stand-ins for the Notify API and `az` (`@vscode/test-electron`; downloads VS Code on first run). |
| `npm run package` | Build, then write `hmcts-notify.vsix`. |

Source layout: the package `@hmcts-cft/notify-tools` finds `((placeholders))`, makes the Edit preview, signs requests to the Notify API and reads keys with `az`. Here, `src/sidebar.ts` is the side view and `src/panel.ts` the editor tab, with `src/service.ts` sharing keys and template lists between them; `src/storage.ts` saves data and drafts; `src/messages.ts` types their messages; `src/webview/` holds the two webviews.
