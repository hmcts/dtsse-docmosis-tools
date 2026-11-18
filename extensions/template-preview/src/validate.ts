import { getAt, isObject, type JsonObject, type PathSegment } from './data';
import { matchesDateFormat } from './dates';
import type { ObjectSchema, Schema } from './schema';

export interface FieldIssue {
  path: PathSegment[];
  message: string;
}

/** A stable key for a data path, used to look an input up by the path it edits. */
export const pathKey = (path: PathSegment[]): string => JSON.stringify(path);

/** A data path in the form `schemaPaths` uses: row indexes become `[]`, as in `items[].name`. */
export function schemaPathOf(path: PathSegment[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += '[]';
    else out += out ? `.${segment}` : segment;
  }
  return out;
}

/**
 * The problem with one value, or undefined when it is fine or can't be checked with certainty.
 * A date with no input format in the template isn't checked: the format Docmosis expects isn't known.
 */
export function validateValue(schema: Schema, value: unknown): string | undefined {
  if (schema.kind !== 'date' || value === undefined || value === null || value === '') return undefined;
  const format = schema.inputFormat;
  if (!format) return undefined;
  if (typeof value !== 'string') return `Expected a date written as ${format}.`;
  if (matchesDateFormat(value, format) !== false) return undefined;
  return `"${value}" isn't a date written as ${format}.`;
}

/** Every value in `data` that Docmosis is certain to reject. Empty values are fine: they render blank. */
export function validateData(schema: ObjectSchema, data: JsonObject): FieldIssue[] {
  const issues: FieldIssue[] = [];
  collect(schema, data, [], issues);
  return issues;
}

function collect(schema: ObjectSchema, data: JsonObject, prefix: PathSegment[], issues: FieldIssue[]): void {
  for (const [key, child] of Object.entries(schema.properties)) {
    const path = [...prefix, key];
    if (child.kind === 'object') collect(child, data, path, issues);
    else if (child.kind === 'array') {
      const rows = getAt(data, path);
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, index) => {
        if (isObject(row)) collect(child.item, data, [...path, index], issues);
      });
    } else {
      const message = validateValue(child, getAt(data, path));
      if (message) issues.push({ path, message });
    }
  }
}

/** The issues that stop a render: none in dev mode, where Docmosis writes errors into the document. */
export function renderBlockers(schema: ObjectSchema, data: JsonObject, dev: boolean): FieldIssue[] {
  return dev ? [] : validateData(schema, data);
}
