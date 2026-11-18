import type { JsonObject } from '../data';
import type { TemplateType } from './client';
import { asText, isBlank, isYes, lookup, parsePlaceholder, PLACEHOLDER } from './placeholders';

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

/**
 * Fills the personalisation in, leaving unfilled placeholders as `((name))`. Lists become
 * markdown bullets where the text is formatted, and `a, b and c` elsewhere, as Notify does.
 */
export function fill(text: string, data: JsonObject, lists: 'bullets' | 'inline'): string {
  return text.replace(PLACEHOLDER, (whole, inner: string) => {
    const { name, conditional } = parsePlaceholder(inner);
    const value = lookup(data, name);
    if (conditional !== undefined) return isYes(value) ? conditional : '';
    if (isBlank(value)) return whole;
    if (!Array.isArray(value)) return asText(value!);
    const items = value.map(asText);
    if (lists === 'bullets') return `\n\n${items.map((i) => `* ${i}`).join('\n')}\n\n`;
    return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  });
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HOLE = String.raw`\(\([^()]+\)\)`;
const MARKDOWN_LINK = String.raw`\[([^\]]+)\]\((https?:\/\/(?:${HOLE}|[^\s()])+)\)`;
/** A bare URL ends at a space, a quote or an angle bracket, and not on trailing punctuation. */
const BARE_URL = String.raw`(https?:\/\/(?:${HOLE}|(?!\(\()[^\s<>"'])*(?:${HOLE}|(?!\(\()[^\s<>"'.,;:!?)]))`;
const TOKEN = new RegExp(`${MARKDOWN_LINK}|${BARE_URL}|(${HOLE})`, 'g');

const withPlaceholders = (text: string) =>
  text
    .split(new RegExp(`(${HOLE})`))
    .map((piece, i) => (i % 2 ? `<span class="placeholder">${escapeHtml(piece)}</span>` : escapeHtml(piece)))
    .join('');

/** Links and placeholders are found in the raw text, then each piece is escaped on its own. */
function inline(text: string): string {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, label, href, bare] = match;
    html += escapeHtml(text.slice(last, match.index));
    if (label !== undefined) html += `<a href="${escapeHtml(href!)}">${withPlaceholders(label)}</a>`;
    else if (bare !== undefined) html += `<a href="${escapeHtml(bare)}">${withPlaceholders(bare)}</a>`;
    else html += withPlaceholders(whole);
    last = match.index + whole.length;
  }
  return html + escapeHtml(text.slice(last));
}

/** Notify's markdown: `#` headings, bullets, numbered lists, `^` inset text, `---` rules, links, paragraphs and line breaks. */
export function notifyMarkdown(text: string): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let inset: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;

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
  const addItem = (tag: 'ul' | 'ol', item: string) => {
    flushParagraph();
    flushInset();
    if (list?.tag !== tag) flushList();
    list ??= { tag, items: [] };
    list.items.push(item);
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    let m: RegExpMatchArray | null;
    if (!trimmed) {
      flush();
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      out.push('<hr>');
    } else if ((m = trimmed.match(/^(#{1,2})\s+(.*)$/))) {
      flush();
      const tag = m[1] === '#' ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(m[2]!)}</${tag}>`);
    } else if ((m = trimmed.match(/^[*\-•]\s+(.*)$/))) {
      addItem('ul', m[1]!);
    } else if ((m = trimmed.match(/^\d+[.)]\s+(.*)$/))) {
      addItem('ol', m[1]!);
    } else if ((m = trimmed.match(/^\^\s?(.*)$/))) {
      flushParagraph();
      flushList();
      inset.push(m[1]!);
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

/** Characters Notify replaces with GSM ones, or removes, before sending a text message (SanitiseText in notifications-utils). */
const SMS_REPLACEMENTS: Record<string, string> = {
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

export function smsCount(raw: string): SmsCount {
  const text = raw.replace(SMS_REPLACEABLE, (c) => SMS_REPLACEMENTS[c]!);
  const chars = [...text];
  const unicode = chars.some((c) => !GSM.has(c) && !GSM_EXTENDED.has(c));
  const characters = unicode ? text.length : chars.reduce((n, c) => n + (GSM_EXTENDED.has(c) ? 2 : 1), 0);
  const [single, part] = unicode ? [70, 67] : [160, 153];
  const fragments = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / part);
  return { characters, fragments, unicode };
}

/** An approximate preview of a template: Notify's own preview is authoritative. */
export function renderLocal(type: TemplateType, subject: string | null | undefined, body: string, data: JsonObject): LocalPreview {
  if (type === 'sms') {
    const text = fill(body, data, 'inline').trim();
    return { text, sms: smsCount(text) };
  }
  return {
    ...(subject ? { subject: fill(subject, data, 'inline') } : {}),
    html: notifyMarkdown(fill(body, data, 'bullets')),
  };
}
