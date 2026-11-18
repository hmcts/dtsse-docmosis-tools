import type { JenkinsViewJob, JenkinsViewWithJobs } from './jenkinsClient';
import { listProducts, matchView } from './products';
import type { BuildStatus } from './status';
import type { RepoEntry } from './workspaceYaml';

export interface Team {
  product: string;
  label: string;
  repos: RepoEntry[];
  view?: JenkinsViewWithJobs;
  status: BuildStatus;
}

/** Worst colour wins: red, then yellow, then running, then green. Jobs without a colour (folders, disabled) are ignored. */
export function aggregateStatus(jobs: JenkinsViewJob[]): BuildStatus {
  const colors = jobs.map((job) => job.color ?? '');
  const base = (color: string) => color.replace(/_anime$/, '');
  if (colors.some((color) => base(color) === 'red')) return 'failure';
  if (colors.some((color) => base(color) === 'yellow')) return 'unstable';
  if (colors.some((color) => color.endsWith('_anime'))) return 'running';
  if (colors.some((color) => color === 'blue')) return 'success';
  return 'notbuilt';
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
        status: view ? aggregateStatus(view.jobs) : ('notbuilt' as const),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}
