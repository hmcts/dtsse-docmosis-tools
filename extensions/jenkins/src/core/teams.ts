import type { JenkinsViewWithJobs } from './jenkinsClient';
import { listProducts, matchView } from './products';
import type { RepoEntry } from './workspaceYaml';

export interface Team {
  product: string;
  label: string;
  repos: RepoEntry[];
  view?: JenkinsViewWithJobs;
}

/** One team per workspace product, sorted by display name. */
export function buildTeams(
  repos: RepoEntry[],
  views: JenkinsViewWithJobs[],
  overrides: Record<string, string> = {},
): Team[] {
  return listProducts(repos)
    .map((product) => {
      const view = matchView(product.name, views, overrides);
      return {
        product: product.name,
        label: view?.name ?? product.name,
        repos: product.repos,
        ...(view ? { view } : {}),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}
