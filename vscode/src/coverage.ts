import { isObject, type JsonObject } from './data';
import type { ObjectSchema } from './schema';

export interface Coverage {
  /** Paths the template reads that the data doesn't supply; repeat fields appear as `rows[].field`. */
  missing: string[];
  /** Paths in the data that the template never reads. */
  unused: string[];
}

/** Compares the data against the schema: what the template needs and lacks, and what the data carries for nothing. */
export function coverage(schema: ObjectSchema, data: JsonObject): Coverage {
  const result: Coverage = { missing: [], unused: [] };
  compare(schema, data, '', result);
  return result;
}

const join = (prefix: string, key: string) => (prefix ? `${prefix}.${key}` : key);
const push = (list: string[], path: string) => {
  if (!list.includes(path)) list.push(path);
};

function compare(schema: ObjectSchema, data: JsonObject, prefix: string, out: Coverage): void {
  for (const [key, child] of Object.entries(schema.properties)) {
    const path = join(prefix, key);
    const value = data[key];
    if (value === undefined || value === null || value === '') {
      push(out.missing, path);
    } else if (child.kind === 'object') {
      if (isObject(value)) compare(child, value, path, out);
    } else if (child.kind === 'array') {
      const rows = Array.isArray(value) ? value.filter(isObject) : [];
      const perRow = rows.map((row) => {
        const rowOut: Coverage = { missing: [], unused: [] };
        compare(child.item, row, `${path}[]`, rowOut);
        return rowOut;
      });
      for (const rowOut of perRow) rowOut.unused.forEach((p) => push(out.unused, p));
      if (perRow.length > 0) {
        for (const p of perRow[0]!.missing) {
          if (perRow.every((r) => r.missing.includes(p))) push(out.missing, p);
        }
      }
    }
  }
  for (const key of Object.keys(data)) {
    if (!(key in schema.properties)) push(out.unused, join(prefix, key));
  }
}
