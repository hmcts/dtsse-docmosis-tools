import { parse } from 'yaml';

export interface RepoEntry {
  /** Clone path relative to the workspace root, such as `apps/pcs/pcs-api`. */
  path: string;
  /** Product under `apps/`, or undefined for `libs/` and `platops/`. */
  product?: string;
  /** GitHub repository name, which is also the Jenkins job name. */
  name: string;
  /** `owner/name`. */
  slug: string;
  ref?: string;
}

function slugOf(url: string): string | undefined {
  const match = /^(?:(?:https?:\/\/|git@)github\.com[/:])?([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1];
}

export function parseWorkspaceYaml(text: string): RepoEntry[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return [];
  }
  const repos = (doc as { repos?: unknown } | null)?.repos;
  if (typeof repos !== 'object' || repos === null || Array.isArray(repos)) return [];

  const entries: RepoEntry[] = [];
  for (const [path, value] of Object.entries(repos)) {
    const url = typeof value === 'string' ? value : (value as { url?: unknown } | null)?.url;
    const slug = typeof url === 'string' ? slugOf(url) : undefined;
    if (!slug) continue;
    const segments = path.split('/');
    const entry: RepoEntry = {
      path,
      name: slug.split('/')[1] as string,
      slug,
    };
    if (segments[0] === 'apps' && segments.length >= 3) entry.product = segments[1] as string;
    const ref = (value as { ref?: unknown } | null)?.ref;
    if (typeof ref === 'string') entry.ref = ref;
    entries.push(entry);
  }
  return entries;
}
