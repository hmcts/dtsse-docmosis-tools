import { getAt, isObject, type Json, type JsonObject, type PathSegment } from '../data';
import { inputToStored, isDateOnlyFormat, storedToInput } from '../dates';
import { pathKey, schemaPathOf } from '../validate';
import type { ArraySchema, ObjectSchema, Schema, ScalarSchema } from '../schema';
import { el } from './dom';

export interface FormHandlers {
  /** A value changed; `undefined` removes the key. Doesn't rebuild the form. */
  set(path: PathSegment[], value: Json | undefined): void;
  addRow(path: PathSegment[]): void;
  removeRow(path: PathSegment[], index: number): void;
  /** The path from the top of the data, for fields inside repeat rows. */
  absolute(path: PathSegment[]): PathSegment[];
}

export function renderForm(schema: ObjectSchema, data: JsonObject, handlers: FormHandlers): HTMLElement {
  return el('div', { class: 'form' }, ...objectFields(schema, data, [], handlers));
}

function objectFields(schema: ObjectSchema, data: JsonObject, prefix: PathSegment[], h: FormHandlers): HTMLElement[] {
  return Object.entries(schema.properties).map(([key, child]) => field(key, child, data, [...prefix, key], h));
}

function field(name: string, schema: Schema, data: JsonObject, path: PathSegment[], h: FormHandlers): HTMLElement {
  switch (schema.kind) {
    case 'object':
      return el(
        'fieldset',
        { class: 'group' },
        el('legend', {}, name),
        ...meta(schema),
        ...objectFields(schema, data, path, h),
      );
    case 'array':
      return repeat(name, schema, data, path, h);
    default:
      return scalar(name, schema, getAt(data, path), path, h);
  }
}

function meta(schema: Schema): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (schema.controls.length > 0) {
    out.push(el('div', { class: 'controls' }, 'Controls: ', ...schema.controls.map((c) => el('code', {}, c))));
  }
  for (const note of schema.notes) out.push(el('div', { class: 'note' }, note));
  return out;
}

function scalar(name: string, schema: ScalarSchema, value: Json | undefined, path: PathSegment[], h: FormHandlers): HTMLElement {
  const id = `f-${path.join('-')}-${Math.random().toString(36).slice(2, 7)}`;

  if (schema.kind === 'boolean') {
    const box = el('input', { type: 'checkbox', id });
    box.checked = value === true;
    box.addEventListener('change', () => h.set(path, box.checked));
    return el('div', { class: 'row boolean' }, box, el('label', { for: id }, name), ...meta(schema));
  }

  const dateOnly = schema.kind === 'date' && isDateOnlyFormat(schema.inputFormat ?? '');
  const full = h.absolute(path);
  const input = el('input', { id, type: dateOnly ? 'date' : 'text', 'data-path': pathKey(full), 'data-schema-path': schemaPathOf(full) });
  const error = el('div', { class: 'field-error', id: `${id}-error`, hidden: true });
  const stored = typeof value === 'string' ? value : '';
  input.value = dateOnly ? storedToInput(stored, schema.inputFormat!) : stored;
  if (schema.kind === 'date' && !dateOnly) input.placeholder = schema.inputFormat ?? '';
  input.addEventListener('input', () => {
    const typed = dateOnly ? inputToStored(input.value, schema.inputFormat!) : input.value;
    h.set(path, typed === '' ? undefined : typed);
  });
  const hint = schema.kind === 'date'
    ? el('span', { class: 'hint' }, schema.inputFormat ? `date, stored as ${schema.inputFormat}` : 'date')
    : undefined;
  return el('div', { class: 'row' }, el('label', { for: id }, name, hint), input, error, ...meta(schema));
}

function repeat(name: string, schema: ArraySchema, data: JsonObject, path: PathSegment[], h: FormHandlers): HTMLElement {
  const value = getAt(data, path);
  const rows = Array.isArray(value) ? value : [];
  const section = el('fieldset', { class: 'group repeat' }, el('legend', {}, `${name} (repeats)`), ...meta(schema));
  rows.forEach((row, index) => {
    const rowData: JsonObject = isObject(row) ? row : {};
    const remove = el('button', { type: 'button', class: 'secondary small', title: 'Remove row' }, 'Remove');
    remove.addEventListener('click', () => h.removeRow(path, index));
    section.append(
      el(
        'div',
        { class: 'repeat-row' },
        el('div', { class: 'repeat-head' }, el('strong', {}, `${name} ${index + 1}`), remove),
        ...Object.entries(schema.item.properties).map(([key, child]) =>
          field(key, child, rowData, [key], rowHandlers(h, [...path, index])),
        ),
      ),
    );
  });
  const add = el('button', { type: 'button', class: 'secondary small' }, `Add ${name} row`);
  add.addEventListener('click', () => h.addRow(path));
  section.append(add);
  return section;
}

/** Handlers for fields inside a repeat row: paths are relative to the row. */
function rowHandlers(h: FormHandlers, rowPath: PathSegment[]): FormHandlers {
  return {
    set: (p, v) => h.set([...rowPath, ...p], v),
    addRow: (p) => h.addRow([...rowPath, ...p]),
    removeRow: (p, i) => h.removeRow([...rowPath, ...p], i),
    absolute: (p) => h.absolute([...rowPath, ...p]),
  };
}

/** Shows or clears a message on an input rendered by this form. */
export function markInput(input: HTMLInputElement, message: string | undefined): void {
  const error = input.nextElementSibling instanceof HTMLElement && input.nextElementSibling.classList.contains('field-error')
    ? input.nextElementSibling
    : undefined;
  input.classList.toggle('invalid', message !== undefined);
  if (message === undefined) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  } else {
    input.setAttribute('aria-invalid', 'true');
    if (error) input.setAttribute('aria-describedby', error.id);
  }
  if (error) {
    error.hidden = message === undefined;
    error.textContent = message ?? '';
  }
}
