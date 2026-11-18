export interface PrStatus {
  context: string;
  state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'ERROR' | 'EXPECTED';
  targetUrl?: string | null;
}

export interface OpenPr {
  slug: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  headSha: string;
  headRef: string;
  statuses: PrStatus[];
}

export class GitHubError extends Error {
  constructor(
    readonly kind: 'auth' | 'network' | 'http',
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

const QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        headRefName
        headRefOid
        repository { nameWithOwner name }
        commits(last: 1) {
          nodes { commit { statusCheckRollup { contexts(first: 50) { nodes { ... on StatusContext { context state targetUrl } } } } } }
        }
      }
    }
  }
}`;

interface SearchNode {
  number?: number;
  title?: string;
  url?: string;
  headRefName?: string;
  headRefOid?: string;
  repository?: { nameWithOwner: string; name: string };
  commits?: {
    nodes?: Array<{
      commit?: { statusCheckRollup?: { contexts?: { nodes?: Array<Partial<PrStatus> | null> } } | null };
    }>;
  };
}

export async function searchMyOpenPrs(
  token: string,
  fetchFn: typeof fetch = fetch,
  org = 'hmcts',
): Promise<OpenPr[]> {
  let response: Response;
  try {
    response = await fetchFn('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { q: `is:pr is:open author:@me org:${org}` } }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new GitHubError('network', `Can't reach GitHub: ${(error as Error).message}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new GitHubError('auth', `GitHub rejected the token (${response.status})`);
  }
  if (!response.ok) throw new GitHubError('http', `GitHub returned ${response.status}`);
  const body = (await response.json()) as {
    data?: { search?: { nodes?: Array<SearchNode | null> } };
    errors?: unknown[];
  };
  if (!body.data) throw new GitHubError('http', 'GitHub returned no data');

  const prs: OpenPr[] = [];
  for (const node of body.data.search?.nodes ?? []) {
    if (!node?.repository || node.number === undefined || !node.headRefOid) continue;
    const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
    const statuses = contexts.filter((c): c is PrStatus => Boolean(c?.context && c.state));
    prs.push({
      slug: node.repository.nameWithOwner,
      repo: node.repository.name,
      number: node.number,
      title: node.title ?? '',
      url: node.url ?? '',
      headSha: node.headRefOid,
      headRef: node.headRefName ?? '',
      statuses,
    });
  }
  return prs;
}
