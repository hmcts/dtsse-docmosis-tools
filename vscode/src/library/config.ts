export const LIBRARIES_SETTING = 'templateLibraries';

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
  if (raw === undefined || raw === null) return { libraries, errors };
  if (!Array.isArray(raw)) return { libraries, errors: ['expected an array of libraries'] };

  const seen = new Set<string>();
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
    const id = `${owner}/${repo}@${ref ?? ''}:${folder}`.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    const label = (entry.label as string | undefined)?.trim() || `${owner}/${repo}${folder ? `/${folder}` : ''}`;
    libraries.push({ id, owner, repo, ref, path: folder, label });
  });
  return { libraries, errors };
}
