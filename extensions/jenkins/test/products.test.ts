import { describe, expect, it } from 'vitest';
import { listProducts, matchView, repoForPath } from '../src/core/products';
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
  it('groups repos by product and sorts by name', () => {
    expect(listProducts(repos).map((p) => [p.name, p.repos.length])).toEqual([
      ['aaa', 1],
      ['civil', 1],
      ['pcs', 2],
      ['zzz', 1],
    ]);
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
});
