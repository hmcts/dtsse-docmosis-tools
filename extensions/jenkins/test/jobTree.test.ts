import { describe, expect, it } from 'vitest';
import type { JobSummary } from '../src/core/jenkinsClient';
import { classifyJobs, masterJobsFromView } from '../src/core/jobTree';

const job = (name: string): JobSummary => ({ name, url: `u/${name}` });

describe('classifyJobs', () => {
  it('splits jobs and orders PRs newest first', () => {
    const result = classifyJobs(
      [job('PR-9'), job('feature%2Fz'), job('master'), job('PR-100'), job('feature%2Fa')],
      [job('master'), job('other')],
    );
    expect(result.master?.name).toBe('master');
    expect(result.nightly?.name).toBe('master');
    expect(result.prs.map((p) => p.number)).toEqual([100, 9]);
    expect(result.branches.map((b) => b.name)).toEqual(['feature%2Fa', 'feature%2Fz']);
  });

  it('accepts main and copes with nothing', () => {
    expect(classifyJobs([job('main')], []).master?.name).toBe('main');
    expect(classifyJobs([], [])).toEqual({ branches: [], prs: [] });
  });
});

describe('masterJobsFromView', () => {
  const v = (folder: string, repo: string, branch: string) => ({
    name: branch,
    url: `https://b/job/${folder}/job/${repo}/job/${branch}/`,
  });
  it('finds main and nightly masters for a repo', () => {
    const jobs = [
      v('HMCTS_j_to_z', 'pcs-api', 'feature%2Fx'),
      v('HMCTS_j_to_z_Nightly', 'pcs-api', 'master'),
      v('HMCTS_j_to_z', 'pcs-api', 'master'),
      v('HMCTS_j_to_z', 'pcs-api', 'main'),
      v('HMCTS_j_to_z_Nightly', 'pcs-api', 'main'),
      v('HMCTS_j_to_z', 'pcs-frontend', 'master'),
      { name: 'x', url: 'https://b/job/odd/' },
    ];
    const found = masterJobsFromView(jobs, 'pcs-api');
    expect(found.main).toBe(jobs[2]);
    expect(found.nightly).toBe(jobs[1]);
    expect(masterJobsFromView(jobs, 'nope')).toEqual({});
  });
});
