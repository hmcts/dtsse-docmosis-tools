import { describe, expect, it } from 'vitest';
import { listProducts, matchView, productForPath, repoForPath, resolveProduct } from '../src/core/products';
import type { RepoEntry } from '../src/core/workspaceYaml';

const repo = (path: string, product?: string): RepoEntry => ({
  path,
  name: path.split('/').pop() as string,
  slug: `hmcts/${path.split('/').pop()}`,
  ...(product ? { product } : {}),
});

const repos = [
  repo('apps/pcs/pcs-api', 'pcs'),
  repo('apps/pcs/pcs-frontend', 'pcs'),
  repo('apps/civil/civil-service', 'civil'),
  repo('apps/aaa/aaa-one', 'aaa'),
  repo('apps/zzz/zzz-one', 'zzz'),
  repo('libs/lib'),
];

describe('listProducts', () => {
  it('groups by product, counts clones and sorts cloned products first', () => {
    const products = listProducts(repos, (p) => p === 'apps/pcs/pcs-api' || p === 'apps/zzz/zzz-one');
    expect(products.map((p) => [p.name, p.repos.length, p.cloned])).toEqual([
      ['pcs', 2, 1],
      ['zzz', 1, 1],
      ['aaa', 1, 0],
      ['civil', 1, 0],
    ]);
  });

  it('sorts alphabetically when none are cloned', () => {
    expect(listProducts(repos, () => false).map((p) => p.name)).toEqual(['aaa', 'civil', 'pcs', 'zzz']);
  });

  it('puts an uncloned product after a cloned one regardless of order', () => {
    const two = [repo('apps/a/a', 'a'), repo('apps/b/b', 'b')];
    expect(listProducts(two, (p) => p === 'apps/b/b').map((p) => p.name)).toEqual(['b', 'a']);
  });
});

describe('matchView', () => {
  const views = [
    { name: 'PCS', url: 'u1' },
    { name: 'Civil-CUI', url: 'u2' },
  ];
  it('matches case-insensitively', () => expect(matchView('pcs', views)?.url).toBe('u1'));
  it('honours overrides', () => expect(matchView('civil', views, { civil: 'civil-cui' })?.url).toBe('u2'));
  it('returns undefined when absent', () => expect(matchView('nfdiv', views)).toBeUndefined());
});

describe('path helpers', () => {
  it('finds the repo that contains a path', () => {
    expect(repoForPath(repos, 'apps/pcs/pcs-api/src/Main.java')?.name).toBe('pcs-api');
    expect(repoForPath(repos, 'apps\\pcs\\pcs-api')?.name).toBe('pcs-api');
    expect(repoForPath(repos, 'apps/pcs/pcs-api-other/x')).toBeUndefined();
  });
  it('derives the product from the path', () => {
    expect(productForPath('apps/pcs/pcs-api/x')).toBe('pcs');
    expect(productForPath('libs/x/y')).toBeUndefined();
    expect(productForPath('apps/pcs')).toBeUndefined();
  });
  it('resolves the first candidate that is a known product', () => {
    const products = listProducts(repos, () => false);
    expect(resolveProduct(products, [undefined, '', 'nope', 'PCS', 'civil'])).toBe('pcs');
    expect(resolveProduct(products, [undefined])).toBeUndefined();
  });
});
