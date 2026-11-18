export const LIBRARIES_SETTING = 'templateLibraries';

/** The setting's default; package.json declares the same value. */
export const DEFAULT_LIBRARIES: readonly Readonly<{ repo: string; path: string }>[] = Object.freeze([
  Object.freeze({ repo: 'hmcts/rdo-docmosis', path: 'Templates' }),
]);

export interface LibraryConfig {
  /** Identifies the library across reloads: repo, ref and path together. */
  id: string;
  owner: string;
  repo: string;
  /** Undefined means the repo's default branch. */
  ref: string | undefined;
  /** Folder prefix in the repo, without leading or trailing slashes; '' is the whole repo. */
  path: string;
  label: string;
}

export interface ParsedLibraries {
  libraries: LibraryConfig[];
  errors: string[];
  /** Usable entries left out because they repeat an earlier one. */
  warnings: string[];
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]+$/;

export function normalisePath(value: string): string {
  return value
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

export function parseLibraries(raw: unknown): ParsedLibraries {
  const libraries: LibraryConfig[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { libraries, errors, warnings };
  if (!Array.isArray(raw)) return { libraries, errors: ['expected an array of libraries'], warnings };

  const seen = new Map<string, number>();
  raw.forEach((item: unknown, index) => {
    const where = `entry ${index + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`${where}: expected an object with a "repo"`);
      return;
    }
    const entry = item as Record<string, unknown>;
    const [owner, repo, ...rest] = typeof entry.repo === 'string' ? entry.repo.trim().split('/') : [];
    if (!owner || !repo || rest.length > 0 || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
      errors.push(`${where}: "repo" must be "owner/name"`);
      return;
    }
    for (const key of ['ref', 'path', 'label'] as const) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') {
        errors.push(`${where}: "${key}" must be a string`);
        return;
      }
    }
    const ref = (entry.ref as string | undefined)?.trim() || undefined;
    const folder = normalisePath((entry.path as string | undefined) ?? '');
    if (folder.split('/').includes('..')) {
      errors.push(`${where}: "path" can't contain ".."`);
      return;
    }
    // GitHub matches owner and repo names case-insensitively; refs and paths are case-sensitive.
    const id = `${owner.toLowerCase()}/${repo.toLowerCase()}@${ref ?? ''}:${folder}`;
    const first = seen.get(id);
    if (first !== undefined) {
      warnings.push(`${where} repeats entry ${first} (same repo, ref and path), so it is ignored`);
      return;
    }
    seen.set(id, index + 1);
    const label = (entry.label as string | undefined)?.trim() || `${owner}/${repo}${folder ? `/${folder}` : ''}`;
    libraries.push({ id, owner, repo, ref, path: folder, label });
  });
  return { libraries, errors, warnings };
}
