import { describe, expect, it, vi } from 'vitest';
import { GitHubError, searchMyOpenPrs } from '../src/core/github';

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const node = {
  number: 5,
  title: 'T',
  url: 'https://github.com/hmcts/pcs-api/pull/5',
  headRefName: 'feat',
  headRefOid: 'abc',
  repository: { nameWithOwner: 'hmcts/pcs-api', name: 'pcs-api' },
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: {
              nodes: [
                {
                  context: 'continuous-integration/jenkins/pr-head',
                  state: 'FAILURE',
                  targetUrl: 'https://b/job/x/1/',
                },
                {},
                null,
              ],
            },
          },
        },
      },
    ],
  },
};

describe('searchMyOpenPrs', () => {
  it('maps search results and sends the query', async () => {
    const f = reply({
      data: {
        search: {
          nodes: [node, null, {}, { ...node, headRefOid: undefined }, { ...node, number: undefined }],
        },
      },
    });
    const prs = await searchMyOpenPrs('tok', f, 'hmcts');
    expect(prs).toEqual([
      {
        slug: 'hmcts/pcs-api',
        repo: 'pcs-api',
        number: 5,
        title: 'T',
        url: 'https://github.com/hmcts/pcs-api/pull/5',
        headSha: 'abc',
        headRef: 'feat',
        statuses: [
          {
            context: 'continuous-integration/jenkins/pr-head',
            state: 'FAILURE',
            targetUrl: 'https://b/job/x/1/',
          },
        ],
      },
    ]);
    const [url, init] = (f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.github.com/graphql');
    expect(JSON.parse(init.body as string).variables.q).toBe('is:pr is:open author:@me org:hmcts');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('copes with PRs that have no statuses or optional fields', async () => {
    const prs = await searchMyOpenPrs(
      't',
      reply({
        data: {
          search: {
            nodes: [{ number: 1, headRefOid: 'x', repository: { nameWithOwner: 'o/r', name: 'r' } }],
          },
        },
      }),
    );
    expect(prs[0]).toMatchObject({ title: '', url: '', headRef: '', statuses: [] });
    expect(await searchMyOpenPrs('t', reply({ data: {} }))).toEqual([]);
  });

  it('reports failures by kind', async () => {
    await expect(searchMyOpenPrs('t', reply({}, 401))).rejects.toMatchObject({ kind: 'auth' });
    await expect(searchMyOpenPrs('t', reply({}, 403))).rejects.toMatchObject({ kind: 'auth' });
    await expect(searchMyOpenPrs('t', reply({}, 500))).rejects.toMatchObject({ kind: 'http' });
    await expect(searchMyOpenPrs('t', reply({ errors: [] }))).rejects.toMatchObject({ kind: 'http' });
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const err = await searchMyOpenPrs('t', down).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.kind).toBe('network');
  });

  it('uses global fetch by default', () => {
    expect(searchMyOpenPrs).toBeTypeOf('function');
  });
});
