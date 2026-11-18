// @ts-check
// The products whose GOV.UK Notify API keys are in AAT Key Vaults. Pure, with no Node built-ins,
// so an editor or browser bundle can import it.

/** @import { NotifyProduct } from './notify-products.js' */

// Each entry is the secret the service mounts from its AAT vault, per its chart or HelmRelease
// `keyVaults:` block and app config. A product with more than one key gets one entry per key,
// as each key may belong to a different Notify service.
//
// Left out, and addable through mergeProducts (the extension's `hmctsTemplatePreview.notify.products`):
// - Civil's `live`, `guest-list` and base `gov-notify-api-key` keys.
// - Copies of keys listed here: the `*-secondary` probate keys, the per-product
//   `notify-mca-api-key` copies, `cath-bootstrap-aat` and `ethos-shared-aat`.
// - Transcribe, which has no key seeded in AAT.
/** @type {readonly Readonly<NotifyProduct>[]} */
export const BUILT_IN_PRODUCTS = Object.freeze([
    { id: 'adoption', label: 'Adoption', vault: 'adoption-aat', secret: 'uk-gov-notify-api-key' },
    { id: 'aac', label: 'Manage Case Assignment (NoC)', vault: 'aac-aat', secret: 'notify-mca-api-key-secret', note: 'NoC emails for every service' },
    { id: 'cath', label: 'CaTH', vault: 'cath-aat', secret: 'govuk-notify-api-key' },
    {
        id: 'civil',
        label: 'Civil',
        vault: 'civil-aat',
        secret: 'gov-notify-pretends-api-key',
        note: "AAT's civil-service uses this key instead of the base gov-notify-api-key",
    },
    { id: 'cmc', label: 'CMC', vault: 'cmc-aat', secret: 'notify-api-key' },
    { id: 'em-ccdorc', label: 'EM CCD orchestrator', vault: 'em-ccdorc-aat', secret: 'notification-api-key' },
    { id: 'em-hrs', label: 'EM hearing recordings', vault: 'em-hrs-api-aat', secret: 'notification-api-key' },
    { id: 'et', label: 'ET (callbacks, SYA)', vault: 'et-aat', secret: 'gov-notify-api-key' },
    { id: 'et-pet', label: 'ET PET (ET1/ET3)', vault: 'et-pet-aat', secret: 'govuk-notify-api-key' },
    { id: 'finrem', label: 'FinRem', vault: 'finrem-aat', secret: 'gov-uk-notification-key' },
    { id: 'fpl', label: 'FPL', vault: 'fpl-aat', secret: 'notify-api-key' },
    { id: 'ia', label: 'IA (asylum)', vault: 'ia-aat', secret: 'ia-gov-notify-key' },
    { id: 'ia-bail', label: 'IA (bail)', vault: 'ia-aat', secret: 'ia-bail-gov-notify-key' },
    { id: 'idam', label: 'IDAM', vault: 'idam-idam-aat', secret: 'notify-api-key' },
    { id: 'nfdiv', label: 'NFDiv', vault: 'nfdiv-aat', secret: 'uk-gov-notify-api-key' },
    { id: 'payment-email', label: 'Payments (email)', vault: 'ccpay-aat', secret: 'notifications-email-apikey' },
    { id: 'payment-letter', label: 'Payments (letters)', vault: 'ccpay-aat', secret: 'notifications-letter-apikey' },
    { id: 'pcs', label: 'PCS', vault: 'pcs-aat', secret: 'gov-notify-key' },
    { id: 'prl', label: 'PRL', vault: 'prl-aat', secret: 'notification-client-api-key' },
    { id: 'probate-bo', label: 'Probate back office', vault: 'probate-aat', secret: 'probate-bo-govNotifyApiKey', note: 'primary rotation slot' },
    {
        id: 'probate-invite',
        label: 'Probate executor invites',
        vault: 'probate-aat',
        secret: 'probate-notify-invite-apikey',
        note: 'primary rotation slot',
    },
    { id: 'pt', label: 'PT', vault: 'pt-kv1-aat', secret: 'gov-notify-key' },
    { id: 'sptribs', label: 'SPTribs', vault: 'sptribs-aat', secret: 'uk-gov-notify-api-key' },
    {
        id: 'sscs',
        label: 'SSCS',
        vault: 'sscs-aat',
        secret: 'notification-key',
        note: 'live key; notification-test-key is for test recipients',
    },
    { id: 'div', label: 'Divorce (legacy)', vault: 'div-aat', secret: 'uk-gov-notify-api-key' },
    { id: 'tax-tribunals', label: 'Tax tribunals', vault: 'tax-tribunals-cft-aat', secret: 'govuk-notify-api-key' },
    { id: 'deed-poll', label: 'Deed poll', vault: 'deed-poll-aat', secret: 'notify-api-key', note: 'unverified: no chart in the workspace' },
    { id: 'enforcement', label: 'Enforcement', vault: 'enforcement-aat', secret: 'govnotify-test-key', note: 'unverified: no chart in the workspace' },
    {
        id: 'fis',
        label: 'FIS',
        vault: 'fis-kv-aat',
        secret: 'uk-gov-notify-api-key',
        note: "unverified: the app reads it, but the chart doesn't mount it",
    },
    { id: 'hmc', label: 'HMC', vault: 'hmc-aat', secret: 'notify-hmc-api-key', note: 'unverified: no chart mounts it' },
    {
        id: 'hwf',
        label: 'Help with Fees (staff)',
        vault: 'help-with-fees-aat',
        secret: 'hwf-staff-notify-api-key',
        note: 'unverified: no chart in the workspace',
    },
].map((p) => Object.freeze(p)));

// Ids become folder names and vault and secret names become az arguments, so all are kept to this.
export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * @param {unknown} value
 * @returns {NotifyProduct | undefined}
 */
function fromEntry(value) {
    if (typeof value !== 'object' || value === null) return undefined;
    const { id, label, vault, secret, note } = /** @type {Record<string, unknown>} */ (value);
    if (typeof id !== 'string' || typeof vault !== 'string' || typeof secret !== 'string') return undefined;
    if (![id, vault, secret].every((v) => SAFE_NAME.test(v))) return undefined;
    return {
        id,
        label: typeof label === 'string' && label.trim() ? label : id,
        vault,
        secret,
        ...(typeof note === 'string' && note ? { note } : {}),
    };
}

/**
 * The built-in table with the entries added, or replacing a built-in entry with the same id,
 * sorted by label. Entries that aren't usable products are dropped.
 * @param {unknown} entries
 * @returns {Readonly<NotifyProduct>[]}
 */
export function mergeProducts(entries) {
    /** @type {Map<string, Readonly<NotifyProduct>>} */
    const byId = new Map(BUILT_IN_PRODUCTS.map((p) => [p.id, p]));
    for (const entry of Array.isArray(entries) ? entries : []) {
        const product = fromEntry(entry);
        if (product) byId.set(product.id, product);
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}
