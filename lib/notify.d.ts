import type { ObjectSchema } from './schema.js';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const NOTIFY_API_URL: string;
export const NOTIFY_ADMIN_URL: string;
/** The template's page in the Notify web app. */
export function templateAdminUrl(serviceId: string, templateId: string): string;

export type TemplateType = 'email' | 'sms' | 'letter';

/** A template as the Notify API returns it. */
export interface NotifyTemplate {
    id: string;
    type: TemplateType;
    name: string;
    version: number;
    body: string;
    subject?: string | null;
    created_at?: string;
    updated_at?: string | null;
    created_by?: string;
    letter_contact_block?: string | null;
}

/** What the Notify API's template preview returns. */
export interface NotifyPreview {
    id: string;
    type: TemplateType;
    version: number;
    body: string;
    subject?: string | null;
    html?: string | null;
}

export type Personalisation = Record<string, string | string[]>;

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
export function mergeProducts(entries: unknown): NotifyProduct[];

export interface Placeholder {
    /** The name as first written in the template. */
    name: string;
    /** The name as Notify compares it. */
    key: string;
    /** True when every use is a `((name??text))` conditional, so the value is yes or no. */
    conditional: boolean;
    /** The text shown by each conditional use. */
    shows: string[];
}

/** Notify matches personalisation to placeholders ignoring case, spaces, underscores and hyphens. */
export function placeholderKey(name: string): string;
export function parsePlaceholder(inner: string): { name: string; conditional?: string };
/** The placeholders in the texts, in order of first use. */
export function findPlaceholders(...texts: (string | null | undefined)[]): Placeholder[];
/** A schema in lib/schema's shape: a string per placeholder and a boolean per conditional, with the text each conditional shows in `notes`. */
export function personalisationSchema(placeholders: Placeholder[]): ObjectSchema;
/** The key in `data` matching the placeholder the way Notify matches it, or the name when no key does. */
export function dataKey(data: JsonObject, name: string): string;
/** Looks a value up the way Notify does, so `First name` finds data saved as `first_name`. */
export function lookup(data: JsonObject, name: string): Json | undefined;
/** true, or a string that is yes, y, true, t or 1 in any case: the values for which Notify shows conditional text. */
export function isYes(value: Json | undefined): boolean;
/** Objects and arrays as JSON, anything else as String() writes it. */
export function asText(value: Json): string;
/** undefined, null, '' or an empty array. */
export function isBlank(value: Json | undefined): boolean;
/** The values a personalisation form shows, keyed by placeholder name: text as a string, conditionals as booleans. */
export function formValues(placeholders: Placeholder[], data: JsonObject): JsonObject;
/** The personalisation for Notify's preview, with each empty placeholder sent as `((name))` and listed in `missing`. */
export function apiPersonalisation(placeholders: Placeholder[], data: JsonObject): { personalisation: Personalisation; missing: string[] };

export interface SmsCount {
    characters: number;
    fragments: number;
    /** True when a character outside the GSM alphabet makes the message Unicode, with shorter fragments. */
    unicode: boolean;
}

export interface LocalPreview {
    subject?: string;
    /** Email and letter bodies. */
    html?: string;
    /** Text message bodies. */
    text?: string;
    sms?: SmsCount;
}

/** Fills the personalisation in, leaving unfilled placeholders as `((name))`; lists become bullets or `a, b and c`. */
export function fill(text: string, data: JsonObject, lists: 'bullets' | 'inline'): string;
/** Notify's markdown as HTML, with unfilled placeholders in `<span class="placeholder">`. */
export function notifyMarkdown(text: string): string;
/** Characters and fragments as Notify counts them, after the replacements Notify makes before sending. */
export function smsCount(raw: string): SmsCount;
/** An approximate preview of a template: Notify's own preview is authoritative. */
export function renderLocal(type: TemplateType, subject: string | null | undefined, body: string, data: JsonObject): LocalPreview;
