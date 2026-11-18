import { describe, expect, it } from 'vitest';
import { aggregateStatus, buildTeams } from '../src/core/teams';
import type { RepoEntry } from '../src/core/workspaceYaml';

const job = (color?: string) => ({ name: 'j', url: 'u', ...(color ? { color } : {}) });
const repo = (product: string, name: string): RepoEntry => ({
  path: `apps/${product}/${name}`,
  name,
  slug: `hmcts/${name}`,
  product,
});

describe('aggregateStatus', () => {
  it('is failure when any job is red, even if running', () => {
    expect(aggregateStatus([job('blue'), job('red')])).toBe('failure');
    expect(aggregateStatus([job('yellow'), job('red_anime')])).toBe('failure');
  });
  it('is unstable when any job is yellow and none is red', () => {
    expect(aggregateStatus([job('blue'), job('yellow')])).toBe('unstable');
    expect(aggregateStatus([job('yellow_anime'), job('blue_anime')])).toBe('unstable');
  });
  it('is running when a job is animated and none failed', () => {
    expect(aggregateStatus([job('blue'), job('blue_anime')])).toBe('running');
    expect(aggregateStatus([job('notbuilt_anime')])).toBe('running');
  });
  it('is success when jobs are blue, ignoring uncoloured and disabled ones', () => {
    expect(aggregateStatus([job('blue'), job('blue'), job(), job('disabled')])).toBe('success');
  });
  it('is not built when there is nothing to judge', () => {
    expect(aggregateStatus([])).toBe('notbuilt');
    expect(aggregateStatus([job(), job('disabled'), job('notbuilt')])).toBe('notbuilt');
  });
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

  it('labels with the view name, sorts by label and aggregates status', () => {
    const teams = buildTeams(repos, views, { civil: 'civil-cui' });
    expect(teams.map((t) => [t.label, t.product, t.status, t.repos.length, t.view?.url])).toEqual([
      ['Alpha', 'alpha', 'notbuilt', 1, 'v-alpha'],
      ['Civil-CUI', 'civil', 'success', 1, 'v-civil'],
      ['PCS', 'pcs', 'failure', 2, 'v-pcs'],
      ['zeta', 'zeta', 'notbuilt', 1, undefined],
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
