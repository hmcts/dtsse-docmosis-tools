import type { PathSegment } from './data';

/** A stable key for a data path, used to look an input up by the path it edits. */
export const pathKey = (path: PathSegment[]): string => JSON.stringify(path);

/** A data path with row indexes as `[]`, as in `items[].name`. */
export function schemaPathOf(path: PathSegment[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += '[]';
    else out += out ? `.${segment}` : segment;
  }
  return out;
}
