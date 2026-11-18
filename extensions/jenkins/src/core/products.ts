import type { RepoEntry } from './workspaceYaml';

export interface Product {
  name: string;
  repos: RepoEntry[];
}

export interface JenkinsView {
  name: string;
  url: string;
}

export function listProducts(repos: RepoEntry[]): Product[] {
  const byName = new Map<string, Product>();
  for (const repo of repos) {
    if (!repo.product) continue;
    let product = byName.get(repo.product);
    if (!product) {
      product = { name: repo.product, repos: [] };
      byName.set(repo.product, product);
    }
    product.repos.push(repo);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function matchView<V extends JenkinsView>(
  product: string,
  views: V[],
  overrides: Record<string, string> = {},
): V | undefined {
  const wanted = (overrides[product] ?? product).toLowerCase();
  return views.find((view) => view.name.toLowerCase() === wanted);
}

/** The repo whose clone contains `relativePath` (a path relative to the workspace root). */
export function repoForPath(repos: RepoEntry[], relativePath: string): RepoEntry | undefined {
  const normalised = relativePath.split('\\').join('/');
  return repos.find((repo) => normalised === repo.path || normalised.startsWith(`${repo.path}/`));
}
