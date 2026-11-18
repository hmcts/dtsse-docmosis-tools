export type JenkinsErrorKind = 'auth' | 'notFound' | 'network' | 'http';

export class JenkinsError extends Error {
  constructor(
    readonly kind: JenkinsErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JenkinsError';
  }
}

export interface BuildSummary {
  number: number;
  result?: string | null;
  building?: boolean;
  timestamp?: number;
  duration?: number;
  url: string;
}

export interface JobSummary {
  name: string;
  url: string;
  color?: string;
  lastBuild?: BuildSummary | null;
}

export interface JobDetail {
  builds: BuildSummary[];
}

export interface Stage {
  id?: string;
  name: string;
  status: string;
  durationMillis?: number;
}

export interface JenkinsViewJob {
  name: string;
  url: string;
  color?: string;
}

export interface JenkinsViewWithJobs {
  name: string;
  url: string;
  jobs: JenkinsViewJob[];
}

export interface BuildRevision {
  commit?: string;
  branch?: string;
}

export interface JenkinsClientOptions {
  baseUrl: string;
  username?: string;
  token?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const BUILD_FIELDS = 'number,result,building,timestamp,duration,url';

export class JenkinsClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(options: JenkinsClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.headers = { Accept: 'application/json' };
    if (options.username && options.token) {
      this.headers.Authorization = `Basic ${Buffer.from(`${options.username}:${options.token}`).toString('base64')}`;
    }
  }

  private async request(url: string, accept = 'application/json'): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { ...this.headers, Accept: accept },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'follow',
      });
    } catch (error) {
      throw new JenkinsError('network', `Can't reach Jenkins: ${(error as Error).message}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new JenkinsError(
        'auth',
        `Jenkins rejected the credentials (${response.status})`,
        response.status,
      );
    }
    if (response.status === 404) throw new JenkinsError('notFound', `Not found: ${url}`, 404);
    if (!response.ok) throw new JenkinsError('http', `Jenkins returned ${response.status}`, response.status);
    return response;
  }

  private async json<T>(url: string): Promise<T> {
    const response = await this.request(url);
    try {
      return (await response.json()) as T;
    } catch {
      // An unauthenticated or login-redirected response is HTML rather than JSON.
      throw new JenkinsError('auth', 'Jenkins did not return JSON; the credentials may be missing');
    }
  }

  private abs(url: string): string {
    return `${url.replace(/\/+$/, '')}/`;
  }

  async listViewsWithJobs(): Promise<JenkinsViewWithJobs[]> {
    const data = await this.json<{
      views?: Array<Omit<JenkinsViewWithJobs, 'jobs'> & { jobs?: JenkinsViewJob[] }>;
    }>(`${this.base}/api/json?tree=views[name,url,jobs[name,url,color]]`);
    return (data.views ?? []).map((view) => ({ ...view, jobs: view.jobs ?? [] }));
  }

  async listJobs(folderUrl: string): Promise<JobSummary[]> {
    const tree = `jobs[name,url,color,lastBuild[${BUILD_FIELDS}]]`;
    const data = await this.json<{ jobs?: JobSummary[] }>(`${this.abs(folderUrl)}api/json?tree=${tree}`);
    return data.jobs ?? [];
  }

  async getJob(jobUrl: string, limit = 10): Promise<JobDetail> {
    const data = await this.json<{ builds?: BuildSummary[] }>(
      `${this.abs(jobUrl)}api/json?tree=builds[${BUILD_FIELDS}]{0,${limit}}`,
    );
    return { builds: data.builds ?? [] };
  }

  async getLastBuild(jobUrl: string): Promise<BuildSummary | undefined> {
    const data = await this.json<{ lastBuild?: BuildSummary | null }>(
      `${this.abs(jobUrl)}api/json?tree=lastBuild[${BUILD_FIELDS}]`,
    );
    return data.lastBuild ?? undefined;
  }

  async getBuild(buildUrl: string): Promise<BuildSummary> {
    return this.json<BuildSummary>(`${this.abs(buildUrl)}api/json?tree=${BUILD_FIELDS}`);
  }

  async getStages(buildUrl: string): Promise<Stage[]> {
    const data = await this.json<{ stages?: Stage[] }>(`${this.abs(buildUrl)}wfapi/describe`);
    return data.stages ?? [];
  }

  async getRevision(buildUrl: string): Promise<BuildRevision> {
    const data = await this.json<{
      actions?: Array<{ lastBuiltRevision?: { SHA1?: string; branch?: Array<{ name?: string }> } }>;
    }>(`${this.abs(buildUrl)}api/json?tree=actions[lastBuiltRevision[SHA1,branch[name]]]`);
    const revision = data.actions?.find((action) => action.lastBuiltRevision)?.lastBuiltRevision;
    const result: BuildRevision = {};
    if (revision?.SHA1) result.commit = revision.SHA1;
    const branch = revision?.branch?.[0]?.name;
    if (branch) result.branch = branch.replace(/^(?:refs\/remotes\/)?origin\//, '');
    return result;
  }
}

export function firstFailedStage(stages: Stage[]): Stage | undefined {
  return stages.find((stage) => stage.status === 'FAILED');
}

export function pausedStage(stages: Stage[]): Stage | undefined {
  return stages.find((stage) => stage.status === 'PAUSED_PENDING_INPUT');
}
