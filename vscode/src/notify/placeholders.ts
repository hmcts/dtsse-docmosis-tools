import type { Json, JsonObject } from '../data';
import type { ObjectSchema, Schema } from '../schema';

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

export const PLACEHOLDER = /\(\(([^()]+)\)\)/g;

/** Notify matches personalisation to placeholders ignoring case, spaces, underscores and hyphens. */
export const placeholderKey = (name: string): string => name.replace(/[\s_-]/g, '').toLowerCase();

export function parsePlaceholder(inner: string): { name: string; conditional?: string } {
  const split = inner.indexOf('??');
  return split < 0 ? { name: inner.trim() } : { name: inner.slice(0, split).trim(), conditional: inner.slice(split + 2) };
}

/** The placeholders in the texts, in order of first use. */
export function findPlaceholders(...texts: (string | null | undefined)[]): Placeholder[] {
  const byKey = new Map<string, Placeholder>();
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(PLACEHOLDER)) {
      const { name, conditional } = parsePlaceholder(match[1]!);
      const key = placeholderKey(name);
      if (!key) continue;
      let found = byKey.get(key);
      if (!found) {
        found = { name, key, conditional: conditional !== undefined, shows: [] };
        byKey.set(key, found);
      }
      if (conditional === undefined) found.conditional = false;
      else found.shows.push(conditional);
    }
  }
  return [...byKey.values()];
}

const clip = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

/** A schema for the existing form: a text input per placeholder and a checkbox per conditional. */
export function personalisationSchema(placeholders: Placeholder[]): ObjectSchema {
  const properties: Record<string, Schema> = {};
  for (const p of placeholders) {
    const notes = p.shows.map((text) => `${p.conditional ? 'Shows' : 'Also shows, when yes'}: "${clip(text.trim())}"`);
    properties[p.name] = { kind: p.conditional ? 'boolean' : 'string', controls: [], notes };
  }
  return { kind: 'object', controls: [], notes: [], properties };
}

/** Looks a value up the way Notify does, so `First name` finds data saved as `first_name`. */
export function lookup(data: JsonObject, name: string): Json | undefined {
  if (name in data) return data[name];
  const key = placeholderKey(name);
  for (const [k, v] of Object.entries(data)) if (placeholderKey(k) === key) return v;
  return undefined;
}

/** Notify shows conditional text for these values. */
export function isYes(value: Json | undefined): boolean {
  if (value === true) return true;
  return typeof value === 'string' && ['yes', 'y', 'true', 't', '1'].includes(value.trim().toLowerCase());
}

export const asText = (value: Json): string => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));

export const isBlank = (value: Json | undefined) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * The personalisation to send to Notify's preview. Notify refuses a preview with any placeholder
 * missing, so an empty one is sent as `((name))`, which Notify shows as written.
 */
export function apiPersonalisation(placeholders: Placeholder[], data: JsonObject): { personalisation: Record<string, string | string[]>; missing: string[] } {
  const personalisation: Record<string, string | string[]> = {};
  const missing: string[] = [];
  for (const p of placeholders) {
    const value = lookup(data, p.name);
    if (p.conditional) {
      personalisation[p.name] = isYes(value) ? 'yes' : 'no';
    } else if (isBlank(value)) {
      personalisation[p.name] = `((${p.name}))`;
      missing.push(p.name);
    } else {
      personalisation[p.name] = Array.isArray(value) ? value.map(asText) : asText(value!);
    }
  }
  return { personalisation, missing };
}
