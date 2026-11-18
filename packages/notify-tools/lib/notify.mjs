// GOV.UK Notify templates: the ((placeholders)) a template reads, and an approximate local
// preview of email, letter and text message bodies.
//
// Pure, with no Node built-ins, so an editor or browser bundle can import it. The products whose
// keys are in AAT Key Vaults are in products.mjs; the API client and the Key Vault reader
// are in node.mjs.

/** @import { Json, JsonObject, LocalPreview, Personalisation, PersonalisationSchema, Placeholder, SmsCount, TemplateType } from './notify.js' */

export const NOTIFY_API_URL = 'https://api.notifications.service.gov.uk';
export const NOTIFY_ADMIN_URL = 'https://www.notifications.service.gov.uk';

/** @param {string} serviceId @param {string} templateId @returns {string} */
export const templateAdminUrl = (serviceId, templateId) => `${NOTIFY_ADMIN_URL}/services/${serviceId}/templates/${templateId}`;

// Placeholders

const PLACEHOLDER = /\(\(([^()]+)\)\)/g;

/** Notify matches personalisation to placeholders ignoring case, spaces, underscores and hyphens. @param {string} name */
export const placeholderKey = (name) => name.replace(/[\s_-]/g, '').toLowerCase();

/**
 * @param {string} inner the text between `((` and `))`
 * @returns {{ name: string, conditional?: string }}
 */
export function parsePlaceholder(inner) {
    const split = inner.indexOf('??');
    return split < 0 ? { name: inner.trim() } : { name: inner.slice(0, split).trim(), conditional: inner.slice(split + 2) };
}

/**
 * The placeholders in the texts, in order of first use.
 * @param {...(string | null | undefined)} texts
 * @returns {Placeholder[]}
 */
export function findPlaceholders(...texts) {
    /** @type {Map<string, Placeholder>} */
    const byKey = new Map();
    for (const text of texts) {
        for (const match of (text ?? '').matchAll(PLACEHOLDER)) {
            const { name, conditional } = parsePlaceholder(match[1]);
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

/** @param {string} text */
const clip = (text) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

/**
 * A form schema: a string per placeholder and a boolean per conditional.
 * @param {Placeholder[]} placeholders
 * @returns {PersonalisationSchema}
 */
export function personalisationSchema(placeholders) {
    /** @type {PersonalisationSchema['properties']} */
    const properties = {};
    for (const p of placeholders) {
        const notes = p.shows.map((text) => `${p.conditional ? 'Shows' : 'Also shows, when yes'}: "${clip(text.trim())}"`);
        properties[p.name] = { kind: p.conditional ? 'boolean' : 'string', controls: [], notes };
    }
    return { kind: 'object', controls: [], notes: [], properties };
}

/**
 * The key in `data` matching the placeholder the way Notify matches it, or the name when no key does.
 * @param {JsonObject} data
 * @param {string} name
 * @returns {string}
 */
export function dataKey(data, name) {
    if (Object.hasOwn(data, name)) return name;
    const key = placeholderKey(name);
    return Object.keys(data).find((k) => placeholderKey(k) === key) ?? name;
}

/**
 * Looks a value up the way Notify does, so `First name` finds data saved as `first_name`.
 * @param {JsonObject} data
 * @param {string} name
 * @returns {Json | undefined}
 */
export function lookup(data, name) {
    const key = dataKey(data, name);
    return Object.hasOwn(data, key) ? data[key] : undefined;
}

/**
 * Notify shows conditional text for these values.
 * @param {Json | undefined} value
 * @returns {boolean}
 */
export function isYes(value) {
    if (value === true) return true;
    return typeof value === 'string' && ['yes', 'y', 'true', 't', '1'].includes(value.trim().toLowerCase());
}

/** @param {Json} value @returns {string} */
export const asText = (value) => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));

/** @param {Json | undefined} value @returns {value is undefined | null | '' | []} */
export const isBlank = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * The values a personalisation form shows, keyed by placeholder name and read as the previews read them.
 * @param {Placeholder[]} placeholders
 * @param {JsonObject} data
 * @returns {JsonObject}
 */
export function formValues(placeholders, data) {
    /** @type {JsonObject} */
    const values = {};
    for (const p of placeholders) {
        const value = lookup(data, p.name);
        if (p.conditional) values[p.name] = isYes(value);
        else if (!isBlank(value)) values[p.name] = asText(value);
    }
    return values;
}

/**
 * The personalisation to send to Notify's preview. Notify refuses a preview with any placeholder
 * missing, so an empty one is sent as `((name))`, which Notify shows as written.
 * @param {Placeholder[]} placeholders
 * @param {JsonObject} data
 * @returns {{ personalisation: Personalisation, missing: string[] }}
 */
export function apiPersonalisation(placeholders, data) {
    /** @type {Personalisation} */
    const personalisation = {};
    /** @type {string[]} */
    const missing = [];
    for (const p of placeholders) {
        const value = lookup(data, p.name);
        if (p.conditional) {
            personalisation[p.name] = isYes(value) ? 'yes' : 'no';
        } else if (isBlank(value)) {
            personalisation[p.name] = `((${p.name}))`;
            missing.push(p.name);
        } else {
            personalisation[p.name] = Array.isArray(value) ? value.map(asText) : asText(value);
        }
    }
    return { personalisation, missing };
}

// Local preview

/**
 * Fills the personalisation in, leaving unfilled placeholders as `((name))`. Lists become
 * markdown bullets where the text is formatted, and `a, b and c` elsewhere, as Notify does.
 * @param {string} text
 * @param {JsonObject} data
 * @param {'bullets' | 'inline'} lists
 * @returns {string}
 */
export function fill(text, data, lists) {
    return text.replace(PLACEHOLDER, (whole, inner) => {
        const { name, conditional } = parsePlaceholder(inner);
        const value = lookup(data, name);
        if (conditional !== undefined) return isYes(value) ? conditional : '';
        if (isBlank(value)) return whole;
        if (!Array.isArray(value)) return asText(value);
        const items = value.map(asText);
        if (lists === 'bullets') return `\n\n${items.map((i) => `* ${i}`).join('\n')}\n\n`;
        return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
    });
}

/** @param {string} text */
const escapeHtml = (text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HOLE = String.raw`\(\([^()]+\)\)`;
const MARKDOWN_LINK = String.raw`\[([^\]]+)\]\((https?:\/\/(?:${HOLE}|[^\s()])+)\)`;
// A bare URL ends at a space, a quote or an angle bracket, and not on trailing punctuation.
const BARE_URL = String.raw`(https?:\/\/(?:${HOLE}|(?!\(\()[^\s<>"'])*(?:${HOLE}|(?!\(\()[^\s<>"'.,;:!?)]))`;
const TOKEN = new RegExp(`${MARKDOWN_LINK}|${BARE_URL}|(${HOLE})`, 'g');
const HOLE_SPLIT = new RegExp(`(${HOLE})`);

/** @param {string} text */
const withPlaceholders = (text) =>
    text
        .split(HOLE_SPLIT)
        .map((piece, i) => (i % 2 ? `<span class="placeholder">${escapeHtml(piece)}</span>` : escapeHtml(piece)))
        .join('');

// Links and placeholders are found in the raw text, then each piece is escaped on its own.
/** @param {string} text */
function inline(text) {
    let html = '';
    let last = 0;
    for (const match of text.matchAll(TOKEN)) {
        const [whole, label, href, bare] = match;
        html += escapeHtml(text.slice(last, match.index));
        if (label) html += `<a href="${escapeHtml(href)}">${withPlaceholders(label)}</a>`;
        else if (bare) html += `<a href="${escapeHtml(bare)}">${withPlaceholders(bare)}</a>`;
        else html += withPlaceholders(whole);
        last = match.index + whole.length;
    }
    return html + escapeHtml(text.slice(last));
}

/**
 * Notify's markdown as HTML: `#` headings, bullets, numbered lists, `^` inset text, `---` rules,
 * links, paragraphs and line breaks. Everything else is escaped.
 * @param {string} text
 * @returns {string}
 */
export function notifyMarkdown(text) {
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    let paragraph = [];
    /** @type {string[]} */
    let inset = [];
    /** @type {{ tag: 'ul' | 'ol', items: string[] } | undefined} */
    let list;

    const flushParagraph = () => {
        if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
        paragraph = [];
    };
    const flushInset = () => {
        if (inset.length) out.push(`<blockquote class="inset">${inset.map(inline).join('<br>')}</blockquote>`);
        inset = [];
    };
    const flushList = () => {
        if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
        list = undefined;
    };
    const flush = () => {
        flushParagraph();
        flushInset();
        flushList();
    };
    /** @param {'ul' | 'ol'} tag @param {string} item */
    const addItem = (tag, item) => {
        flushParagraph();
        flushInset();
        if (list?.tag !== tag) flushList();
        list ??= { tag, items: [] };
        list.items.push(item);
    };

    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = line.trim();
        let m;
        if (!trimmed) {
            flush();
        } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            flush();
            out.push('<hr>');
        } else if ((m = trimmed.match(/^(#{1,2})\s+(.*)$/))) {
            flush();
            const tag = m[1] === '#' ? 'h2' : 'h3';
            out.push(`<${tag}>${inline(m[2])}</${tag}>`);
        } else if ((m = trimmed.match(/^[*\-•]\s+(.*)$/))) {
            addItem('ul', m[1]);
        } else if ((m = trimmed.match(/^\d+[.)]\s+(.*)$/))) {
            addItem('ol', m[1]);
        } else if ((m = trimmed.match(/^\^\s?(.*)$/))) {
            flushParagraph();
            flushList();
            inset.push(m[1]);
        } else if (inset.length) {
            inset.push(trimmed);
        } else {
            flushList();
            paragraph.push(trimmed);
        }
    }
    flush();
    return out.join('\n');
}

const GSM = new Set(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_EXTENDED = new Set('^{}\\[~]|€\f');

// Characters Notify replaces with GSM ones, or removes, before sending a text message
// (SanitiseText in notifications-utils).
/** @type {Record<string, string>} */
const SMS_REPLACEMENTS = {
    '\u2011': '-', // non-breaking hyphen
    '\u2013': '-', // en dash
    '\u2014': '-', // em dash
    '\u2212': '-', // minus sign
    '\u2026': '...', // ellipsis
    '\u2018': "'",
    '\u2019': "'",
    '\u201a': "'",
    '\u201c': '"',
    '\u201d': '"',
    '\u201e': '"',
    '\u180e': '',
    '\u200b': '',
    '\u200c': '',
    '\u2060': '',
    '\ufeff': '',
    '\u2028': '',
    '\u2029': '',
    '\u00a0': ' ', // non-breaking space
    '\u202f': ' ', // narrow non-breaking space
    '\t': ' ',
};
const SMS_REPLACEABLE = new RegExp(`[${Object.keys(SMS_REPLACEMENTS).join('')}]`, 'g');

/**
 * @param {string} raw a text message as it will be sent, placeholders filled
 * @returns {SmsCount}
 */
export function smsCount(raw) {
    const text = raw.replace(SMS_REPLACEABLE, (c) => SMS_REPLACEMENTS[c]);
    const chars = [...text];
    const unicode = chars.some((c) => !GSM.has(c) && !GSM_EXTENDED.has(c));
    const characters = unicode ? chars.length : chars.reduce((n, c) => n + (GSM_EXTENDED.has(c) ? 2 : 1), 0);
    const [single, part] = unicode ? [70, 67] : [160, 153];
    const fragments = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / part);
    return { characters, fragments, unicode };
}

/**
 * An approximate preview of a template: Notify's own preview is authoritative.
 * @param {TemplateType} type
 * @param {string | null | undefined} subject
 * @param {string} body
 * @param {JsonObject} data
 * @returns {LocalPreview}
 */
export function renderLocal(type, subject, body, data) {
    if (type === 'sms') {
        const text = fill(body, data, 'inline').trim();
        return { text, sms: smsCount(text) };
    }
    return {
        ...(subject ? { subject: fill(subject, data, 'inline') } : {}),
        html: notifyMarkdown(fill(body, data, 'bullets')),
    };
}
