import type { JenkinsViewJob, JobSummary } from './jenkinsClient';
import { decodeJobName, prNumberOf } from './jenkinsPaths';

const MAIN_BRANCHES = ['master', 'main'];

export interface ClassifiedJobs {
  master?: JobSummary;
  nightly?: JobSummary;
  branches: JobSummary[];
  prs: Array<{ job: JobSummary; number: number }>;
}

/** Splits a repo's jobs into master, nightly master, other branches and PRs (newest first). */
export function classifyJobs(main: JobSummary[], nightly: JobSummary[]): ClassifiedJobs {
  const master = main.find((job) => MAIN_BRANCHES.includes(job.name));
  const nightlyMaster = nightly.find((job) => MAIN_BRANCHES.includes(job.name));
  const prs: ClassifiedJobs['prs'] = [];
  const branches: JobSummary[] = [];
  for (const job of main) {
    const number = prNumberOf(job.name);
    if (number !== undefined) prs.push({ job, number });
    else if (job !== master) branches.push(job);
  }
  prs.sort((a, b) => b.number - a.number);
  branches.sort((a, b) => decodeJobName(a.name).localeCompare(decodeJobName(b.name)));
  const result: ClassifiedJobs = { branches, prs };
  if (master) result.master = master;
  if (nightlyMaster) result.nightly = nightlyMaster;
  return result;
}

/** Picks a repo's master and nightly-master jobs out of a Build Monitor view's jobs. */
export function masterJobsFromView(
  jobs: JenkinsViewJob[],
  repoName: string,
): { main?: JenkinsViewJob; nightly?: JenkinsViewJob } {
  const result: { main?: JenkinsViewJob; nightly?: JenkinsViewJob } = {};
  for (const job of jobs) {
    const match = /\/job\/([^/]+)\/job\/([^/]+)\/job\/([^/]+)\/?$/.exec(job.url);
    if (!match || decodeJobName(match[2] as string) !== repoName) continue;
    if (!MAIN_BRANCHES.includes(match[3] as string)) continue;
    if ((match[1] as string).endsWith('_Nightly')) result.nightly ??= job;
    else result.main ??= job;
  }
  return result;
}
