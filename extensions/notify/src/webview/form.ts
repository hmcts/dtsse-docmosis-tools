import type { PersonalisationSchema } from '@hmcts-cft/notify-tools';
import { getAt, type Json, type JsonObject, type PathSegment } from '../data';
import { el } from './dom';

type FieldSchema = PersonalisationSchema['properties'][string];

export interface FormHandlers {
  /** A value changed; `undefined` removes the key. Doesn't rebuild the form. */
  set(path: PathSegment[], value: Json | undefined): void;
}

export function renderForm(schema: PersonalisationSchema, data: JsonObject, handlers: FormHandlers): HTMLElement {
  return el('div', { class: 'form' }, ...Object.entries(schema.properties).map(([name, child]) => field(name, child, getAt(data, [name]), handlers)));
}

function meta(schema: FieldSchema): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (schema.controls.length > 0) {
    out.push(el('div', { class: 'controls' }, 'Controls: ', ...schema.controls.map((c) => el('code', {}, c))));
  }
  for (const note of schema.notes) out.push(el('div', { class: 'note' }, note));
  return out;
}

function field(name: string, schema: FieldSchema, value: Json | undefined, h: FormHandlers): HTMLElement {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;

  if (schema.kind === 'boolean') {
    const box = el('input', { type: 'checkbox', id });
    box.checked = value === true;
    box.addEventListener('change', () => h.set([name], box.checked));
    return el('div', { class: 'row boolean' }, box, el('label', { for: id }, name), ...meta(schema));
  }

  const input = el('input', { id, type: 'text' });
  input.value = typeof value === 'string' ? value : '';
  input.addEventListener('input', () => h.set([name], input.value === '' ? undefined : input.value));
  return el('div', { class: 'row' }, el('label', { for: id }, name), input, ...meta(schema));
}
