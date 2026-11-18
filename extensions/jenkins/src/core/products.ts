import type { RepoEntry } from './workspaceYaml';

export interface Product {
  name: string;
  repos: RepoEntry[];
  /** Number of repos whose clone exists locally. */
  cloned: number;
}

export interface JenkinsView {
  name: string;
  url: string;
}

export function listProducts(repos: RepoEntry[], isCloned: (path: string) => boolean): Product[] {
  const byName = new Map<string, Product>();
  for (const repo of repos) {
    if (!repo.product) continue;
    let product = byName.get(repo.product);
    if (!product) {
      product = { name: repo.product, repos: [], cloned: 0 };
      byName.set(repo.product, product);
    }
    product.repos.push(repo);
    if (isCloned(repo.path)) product.cloned++;
  }
  return [...byName.values()].sort((a, b) => {
    if (a.cloned > 0 !== b.cloned > 0) return a.cloned > 0 ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function matchView(
  product: string,
  views: JenkinsView[],
  overrides: Record<string, string> = {},
): JenkinsView | undefined {
  const wanted = (overrides[product] ?? product).toLowerCase();
  return views.find((view) => view.name.toLowerCase() === wanted);
}

/** The repo whose clone contains `relativePath` (a path relative to the workspace root). */
export function repoForPath(repos: RepoEntry[], relativePath: string): RepoEntry | undefined {
  const normalised = relativePath.split('\\').join('/');
  return repos.find((repo) => normalised === repo.path || normalised.startsWith(`${repo.path}/`));
}

export function productForPath(relativePath: string): string | undefined {
  const match = /^apps\/([^/]+)\/[^/]+/.exec(relativePath.split('\\').join('/'));
  return match?.[1];
}

export function resolveProduct(
  products: Product[],
  candidates: Array<string | undefined>,
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const found = products.find((product) => product.name.toLowerCase() === candidate.toLowerCase());
    if (found) return found.name;
  }
  return undefined;
}
