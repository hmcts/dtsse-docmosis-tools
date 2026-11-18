import { describe, expect, it } from 'vitest';
import { buildTeams } from '../src/core/teams';
import type { RepoEntry } from '../src/core/workspaceYaml';

const job = (color?: string) => ({ name: 'j', url: 'u', ...(color ? { color } : {}) });
const repo = (product: string, name: string): RepoEntry => ({
  path: `apps/${product}/${name}`,
  name,
  slug: `hmcts/${name}`,
  product,
});

describe('buildTeams', () => {
  const repos = [
    repo('pcs', 'pcs-api'),
    repo('pcs', 'pcs-frontend'),
    repo('civil', 'civil-service'),
    repo('zeta', 'z'),
    repo('alpha', 'a'),
  ];
  const views = [
    { name: 'PCS', url: 'v-pcs', jobs: [job('red')] },
    { name: 'Civil-CUI', url: 'v-civil', jobs: [job('blue')] },
    { name: 'Alpha', url: 'v-alpha', jobs: [] },
  ];

  it('labels with the view name, and sorts by label', () => {
    const teams = buildTeams(repos, views, { civil: 'civil-cui' });
    expect(teams.map((t) => [t.label, t.product, t.repos.length, t.view?.url])).toEqual([
      ['Alpha', 'alpha', 1, 'v-alpha'],
      ['Civil-CUI', 'civil', 1, 'v-civil'],
      ['PCS', 'pcs', 2, 'v-pcs'],
      ['zeta', 'zeta', 1, undefined],
    ]);
  });

  it('sorts by display name rather than product name, ignoring case', () => {
    const teams = buildTeams([repo('b', 'x'), repo('a', 'y')], [{ name: 'Zed', url: 'z', jobs: [] }], {
      a: 'zed',
    });
    expect(teams.map((t) => t.label)).toEqual(['b', 'Zed']);
  });

  it('defaults overrides', () => {
    expect(buildTeams(repos, views)[0]?.label).toBe('Alpha');
  });
});
