export const DEFAULT_JENKINS_URL = 'https://build.hmcts.net';

export function folderFor(repoName: string, nightly = false): string {
  const first = repoName.charAt(0).toLowerCase();
  let folder = 'HMCTS_a_to_c';
  if (first >= 'd' && first <= 'i') folder = 'HMCTS_d_to_i';
  else if (first >= 'j' && first <= 'z') folder = 'HMCTS_j_to_z';
  return nightly ? `${folder}_Nightly` : folder;
}

function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

export function repoJobUrl(base: string, repoName: string, nightly = false): string {
  return `${trimBase(base)}/job/${folderFor(repoName, nightly)}/job/${encodeURIComponent(repoName)}/`;
}

/** `name` is a job name as Jenkins reports it, so already URL-encoded for branches. */
export function childJobUrl(repoJob: string, name: string): string {
  return `${repoJob.replace(/\/+$/, '')}/job/${name}/`;
}

export function decodeJobName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function prNumberOf(jobName: string): number | undefined {
  const match = /^PR-(\d+)$/.exec(jobName);
  return match ? Number(match[1]) : undefined;
}

export interface ParsedBuildUrl {
  /** Job URL with a trailing slash. */
  jobUrl: string;
  number: number;
  /** Build URL with a trailing slash. */
  buildUrl: string;
  repo?: string;
  jobName?: string;
}

export function parseBuildUrl(url: string): ParsedBuildUrl | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const match = /^(\/(?:job\/[^/]+\/)+?)(\d+)(?:\/.*)?$/.exec(parsed.pathname);
  if (!match) return undefined;
  const jobPath = match[1] as string;
  const number = Number(match[2]);
  const names = [...jobPath.matchAll(/job\/([^/]+)\//g)].map((m) => m[1] as string);
  const result: ParsedBuildUrl = {
    jobUrl: `${parsed.origin}${jobPath}`,
    number,
    buildUrl: `${parsed.origin}${jobPath}${number}/`,
  };
  if (names.length >= 3) {
    result.repo = decodeJobName(names[1] as string);
    result.jobName = decodeJobName(names[2] as string);
  }
  return result;
}
