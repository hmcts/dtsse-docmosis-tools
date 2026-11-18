export type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export type GitHubErrorKind = 'unauthorized' | 'sso' | 'notFound' | 'rateLimited' | 'network' | 'http';

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    readonly status?: number,
    /** The page that authorises the token for the organisation's SAML SSO. */
    readonly ssoUrl?: string,
    readonly resetAt?: Date,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface TreeEntry {
  path: string;
  mode?: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export interface Tree {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

export type CommitCheck = { modified: false } | { modified: true; sha: string; etag: string | undefined };

export interface Template {
  path: string;
  sha: string;
  size: number;
}

/** A blob the listing keeps: a .docx under the folder, skipping Word's `~$` lock files. */
export function isTemplate(file: string, prefix: string): boolean {
  if (prefix && !file.startsWith(`${prefix}/`)) return false;
  const name = file.slice(file.lastIndexOf('/') + 1);
  return name.toLowerCase().endsWith('.docx') && !name.startsWith('~$');
}

const API_VERSION = '2022-11-28';
const WALK_CONCURRENCY = 8;

export class GitHubClient {
  constructor(
    private readonly fetch: FetchLike,
    private readonly token: string | undefined,
    private readonly api = 'https://api.github.com',
  ) {}

  /** Resolves `ref` (or the default branch) to a commit sha, or reports that it matches `etag`. */
  async commit(owner: string, repo: string, ref: string | undefined, etag?: string): Promise<CommitCheck> {
    const headers: Record<string, string> = { accept: 'application/vnd.github.sha' };
    if (etag) headers['if-none-match'] = etag;
    const response = await this.request(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref ?? 'HEAD')}`, headers, `${owner}/${repo}`);
    if (response.status === 304) return { modified: false };
    return { modified: true, sha: (await response.text()).trim(), etag: response.headers.get('etag') ?? undefined };
  }

  async tree(owner: string, repo: string, sha: string, recursive: boolean, signal?: AbortSignal): Promise<Tree> {
    const query = recursive ? '?recursive=1' : '';
    const response = await this.request(`/repos/${owner}/${repo}/git/trees/${sha}${query}`, { accept: 'application/vnd.github+json' }, `${owner}/${repo}`, signal);
    return (await response.json()) as Tree;
  }

  async blob(owner: string, repo: string, sha: string): Promise<Uint8Array> {
    const response = await this.request(`/repos/${owner}/${repo}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw' }, `${owner}/${repo}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Every template under `prefix` at commit `sha`. One recursive tree call covers most repos;
   * when GitHub truncates it, walks the folders under `prefix` one tree at a time.
   */
  async templates(owner: string, repo: string, sha: string, prefix: string): Promise<Template[]> {
    const full = await this.tree(owner, repo, sha, true);
    if (!full.truncated) return toTemplates(full.tree, '', prefix);

    let root = await this.tree(owner, repo, sha, false);
    for (const part of prefix ? prefix.split('/') : []) {
      const next = root.tree.find((entry) => entry.type === 'tree' && entry.path === part);
      if (!next) return [];
      root = await this.tree(owner, repo, next.sha, false);
    }

    const found: Template[] = [];
    const queue: Array<{ sha: string; base: string }> = [];
    const visit = (listing: Tree, base: string): void => {
      for (const entry of listing.tree) {
        if (entry.type === 'tree') queue.push({ sha: entry.sha, base: base ? `${base}/${entry.path}` : entry.path });
      }
      found.push(...toTemplates(listing.tree, base, prefix));
    };
    visit(root, prefix);
    // The first failure fails the walk: the other workers stop taking folders and their requests are cancelled.
    const stop = new AbortController();
    const worker = async (): Promise<void> => {
      try {
        while (!stop.signal.aborted) {
          const item = queue.shift();
          if (!item) return;
          visit(await this.tree(owner, repo, item.sha, false, stop.signal), item.base);
        }
      } catch (error) {
        stop.abort();
        throw error;
      }
    };
    // Workers that find the queue empty exit early, so keep starting them while folders are queued.
    while (queue.length > 0) await Promise.all(Array.from({ length: Math.min(WALK_CONCURRENCY, queue.length) }, worker));
    return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  private async request(route: string, headers: Record<string, string>, repo: string, signal?: AbortSignal): Promise<Response> {
    const all: Record<string, string> = {
      'x-github-api-version': API_VERSION,
      'user-agent': 'hmcts-template-preview',
      ...headers,
    };
    if (this.token) all.authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.fetch(`${this.api}${route}`, { headers: all, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new GitHubError('network', `Can't reach GitHub: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.ok || response.status === 304) return response;
    throw errorFor(response, repo);
  }
}

function toTemplates(entries: TreeEntry[], base: string, prefix: string): Template[] {
  const out: Template[] = [];
  for (const entry of entries) {
    if (entry.type !== 'blob') continue;
    const file = base ? `${base}/${entry.path}` : entry.path;
    if (isTemplate(file, prefix)) out.push({ path: file, sha: entry.sha, size: entry.size ?? 0 });
  }
  return out;
}

/** The SSO link is opened in the browser, so only an https page on github.com is kept. */
function githubPage(candidate: string | undefined): string | undefined {
  if (!candidate || !URL.canParse(candidate)) return undefined;
  const { protocol, hostname } = new URL(candidate);
  return protocol === 'https:' && hostname === 'github.com' ? candidate : undefined;
}

export function errorFor(response: Response, repo: string): GitHubError {
  const { status, headers } = response;
  if (status === 401) return new GitHubError('unauthorized', 'GitHub rejected the token. Sign in to GitHub again.', status);

  const sso = headers.get('x-github-sso');
  if (status === 403 && sso) {
    const url = githubPage(/url=([^;\s]+)/.exec(sso)?.[1]);
    return new GitHubError(
      'sso',
      `The GitHub token isn't authorised for the organisation that owns ${repo}. Authorise it for SAML single sign-on${url ? `: ${url}` : '.'}`,
      status,
      url,
    );
  }

  if (status === 429 || (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))) {
    // retry-after comes with a secondary limit, which applies even when the primary limit has requests left.
    const retry = Number(headers.get('retry-after'));
    const reset = Number(headers.get('x-ratelimit-reset'));
    const resetAt = Number.isFinite(retry) && retry > 0 ? new Date(Date.now() + retry * 1000) : Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : undefined;
    return new GitHubError(
      'rateLimited',
      `GitHub's rate limit is used up${resetAt ? `; it resets at ${resetAt.toLocaleTimeString()}` : ''}.`,
      status,
      undefined,
      resetAt,
    );
  }

  if (status === 404) {
    return new GitHubError('notFound', `${repo} doesn't exist, or the GitHub account you're signed in with can't see it.`, status);
  }
  return new GitHubError('http', `GitHub answered ${status} ${response.statusText} for ${repo}.`, status);
}
