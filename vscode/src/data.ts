import type { Json, JsonObject } from '@hmcts-cft/docmosis-tools/notify';

export type { Json, JsonObject };

export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Merges `incoming` over `base`: objects merge key by key, everything else (arrays included) is replaced. */
export function mergeData(base: JsonObject, incoming: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const existing = out[key];
    out[key] = isObject(existing) && isObject(value) ? mergeData(existing, value) : value;
  }
  return out;
}

export type PathSegment = string | number;

export function getAt(data: Json | undefined, path: PathSegment[]): Json | undefined {
  let current: Json | undefined = data;
  for (const segment of path) {
    if (typeof segment === 'number') current = Array.isArray(current) ? current[segment] : undefined;
    else current = isObject(current) ? current[segment] : undefined;
  }
  return current;
}

/**
 * Returns a copy of `data` with `path` set to `value`. An undefined value removes the key, and
 * objects left empty by the removal are removed too, so the data holds only what was supplied.
 */
export function setAt(data: JsonObject, path: PathSegment[], value: Json | undefined): JsonObject {
  const [head, ...rest] = path;
  if (head === undefined) return data;
  const result = setIn(data, head, rest, value);
  return isObject(result) ? result : {};
}

function setIn(node: Json | undefined, head: PathSegment, rest: PathSegment[], value: Json | undefined): Json | undefined {
  if (typeof head === 'number') {
    const array = Array.isArray(node) ? [...node] : [];
    for (let i = array.length; i < head; i++) array[i] = {};
    const next = rest.length === 0 ? value : setIn(array[head], rest[0]!, rest.slice(1), value);
    array[head] = next === undefined ? {} : next;
    return array;
  }
  const object: JsonObject = isObject(node) ? { ...node } : {};
  const next = rest.length === 0 ? value : setIn(object[head], rest[0]!, rest.slice(1), value);
  if (next === undefined || (isObject(next) && Object.keys(next).length === 0 && rest.length > 0)) delete object[head];
  else object[head] = next;
  return object;
}
