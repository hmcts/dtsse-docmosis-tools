export interface NotifyProduct {
    id: string;
    label: string;
    /** An AAT Key Vault. */
    vault: string;
    /** The secret in `vault` holding the product's Notify API key. */
    secret: string;
    note?: string;
}

/** Each product's Notify API key, as the service mounts it from its AAT Key Vault. */
export const BUILT_IN_PRODUCTS: readonly Readonly<NotifyProduct>[];
/** Letters, digits and hyphens, not starting with a hyphen: what product ids, vault names and secret names are kept to. */
export const SAFE_NAME: RegExp;
/**
 * BUILT_IN_PRODUCTS with `entries` added, or replacing a built-in entry with the same id, sorted by label.
 * An entry needs `id`, `vault` and `secret` matching SAFE_NAME, or it is dropped; `label` defaults to `id`.
 */
export function mergeProducts(entries: unknown): Readonly<NotifyProduct>[];
