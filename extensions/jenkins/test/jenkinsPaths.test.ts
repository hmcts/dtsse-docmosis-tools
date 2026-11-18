import { describe, expect, it } from 'vitest';
import {
  childJobUrl,
  decodeJobName,
  folderFor,
  parseBuildUrl,
  prNumberOf,
  repoJobUrl,
} from '../src/core/jenkinsPaths';

describe('jenkins paths', () => {
  it.each([
    ['civil-service', 'HMCTS_a_to_c'],
    ['ccd-data-store-api', 'HMCTS_a_to_c'],
    ['dtsse-x', 'HMCTS_d_to_i'],
    ['Ia-case-api', 'HMCTS_d_to_i'],
    ['pcs-api', 'HMCTS_j_to_z'],
    ['zzz', 'HMCTS_j_to_z'],
    ['1repo', 'HMCTS_a_to_c'],
  ])('puts %s in %s', (repo, folder) => expect(folderFor(repo)).toBe(folder));

  it('adds the Nightly suffix', () => expect(folderFor('pcs-api', true)).toBe('HMCTS_j_to_z_Nightly'));

  it('builds job URLs', () => {
    expect(repoJobUrl('https://build.hmcts.net/', 'pcs-api')).toBe(
      'https://build.hmcts.net/job/HMCTS_j_to_z/job/pcs-api/',
    );
    expect(repoJobUrl('https://b', 'pcs-api', true)).toBe('https://b/job/HMCTS_j_to_z_Nightly/job/pcs-api/');
    expect(childJobUrl('https://b/job/F/job/r/', 'feature%2Fx')).toBe(
      'https://b/job/F/job/r/job/feature%2Fx/',
    );
    expect(childJobUrl('https://b/job/F/job/r', 'master')).toBe('https://b/job/F/job/r/job/master/');
  });

  it('decodes job names', () => {
    expect(decodeJobName('feature%2Fx')).toBe('feature/x');
    expect(decodeJobName('100%')).toBe('100%');
  });

  it('reads PR numbers', () => {
    expect(prNumberOf('PR-123')).toBe(123);
    expect(prNumberOf('master')).toBeUndefined();
  });

  it('parses build URLs, including display/redirect suffixes', () => {
    expect(
      parseBuildUrl('https://build.hmcts.net/job/HMCTS_j_to_z/job/pcs-api/job/PR-123/7/display/redirect'),
    ).toEqual({
      jobUrl: 'https://build.hmcts.net/job/HMCTS_j_to_z/job/pcs-api/job/PR-123/',
      number: 7,
      buildUrl: 'https://build.hmcts.net/job/HMCTS_j_to_z/job/pcs-api/job/PR-123/7/',
      repo: 'pcs-api',
      jobName: 'PR-123',
    });
    expect(parseBuildUrl('https://b/job/feature%2Fx/3/')).toEqual({
      jobUrl: 'https://b/job/feature%2Fx/',
      number: 3,
      buildUrl: 'https://b/job/feature%2Fx/3/',
    });
    expect(parseBuildUrl('https://b/blue/organizations/x')).toBeUndefined();
    expect(parseBuildUrl('not a url')).toBeUndefined();
  });
});
