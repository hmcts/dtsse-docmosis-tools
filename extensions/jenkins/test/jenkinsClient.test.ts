import { describe, expect, it, vi } from 'vitest';
import { firstFailedStage, JenkinsClient, JenkinsError, pausedStage } from '../src/core/jenkinsClient';

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {}),
  ) as unknown as typeof fetch & {
    mock: { calls: Array<[string, RequestInit]> };
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const client = (f: typeof fetch, auth = true) =>
  new JenkinsClient({
    baseUrl: 'https://j/',
    ...(auth ? { username: 'u', token: 't' } : {}),
    fetch: f,
  });

describe('JenkinsClient requests', () => {
  it('sends basic auth and the right URLs', async () => {
    const f = fakeFetch(() =>
      json({
        views: [
          { name: 'PCS', url: 'v', jobs: [{ name: 'j', url: 'ju', color: 'blue' }] },
          { name: 'Empty', url: 'e' },
        ],
      }),
    );
    expect(await client(f).listViewsWithJobs()).toEqual([
      { name: 'PCS', url: 'v', jobs: [{ name: 'j', url: 'ju', color: 'blue' }] },
      { name: 'Empty', url: 'e', jobs: [] },
    ]);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://j/api/json?tree=views[name,url,jobs[name,url,color]]');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('u:t').toString('base64')}`,
    );
  });

  it('omits auth without credentials', async () => {
    const f = fakeFetch(() => json({}));
    expect(await client(f, false).listViewsWithJobs()).toEqual([]);
    expect(
      ((f.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it('defaults to global fetch and its timeout', () => {
    expect(new JenkinsClient({ baseUrl: 'https://j' })).toBeInstanceOf(JenkinsClient);
  });

  it('reads views, jobs, builds and stages', async () => {
    const seen: string[] = [];
    const f = fakeFetch((url) => {
      seen.push(url);
      if (url.includes('tree=jobs')) return json({ jobs: [{ name: 'master', url: 'm' }] });
      if (url.includes('tree=builds')) return json({ builds: [{ number: 1, url: 'b' }] });
      if (url.includes('tree=lastBuild')) return json({ lastBuild: null });
      if (url.includes('wfapi')) return json({ stages: [{ name: 'Build', status: 'SUCCESS' }] });
      return json({ number: 5, url: 'b5' });
    });
    const c = client(f);
    expect(await c.listJobs('https://j/job/F/job/r')).toEqual([{ name: 'master', url: 'm' }]);
    expect((await c.getJob('https://j/job/F/job/r/job/master/', 5)).builds).toHaveLength(1);
    expect(await c.getLastBuild('https://j/job/x/')).toBeUndefined();
    expect((await c.getStages('https://j/job/x/1/'))[0]?.name).toBe('Build');
    expect((await c.getBuild('https://j/job/x/1')).number).toBe(5);
    expect(seen[0]).toBe(
      'https://j/job/F/job/r/api/json?tree=jobs[name,url,color,lastBuild[number,result,building,timestamp,duration,url]]',
    );
    expect(seen[1]).toContain('{0,5}');
  });

  it('defaults empty collections', async () => {
    const c = client(fakeFetch(() => json({})));
    expect(await c.listJobs('u')).toEqual([]);
    expect((await c.getJob('u')).builds).toEqual([]);
    expect(await c.getLastBuild('u')).toBeUndefined();
    expect(await c.getStages('u')).toEqual([]);
  });

  it('reads the built revision', async () => {
    const c = client(
      fakeFetch(() =>
        json({
          actions: [
            {},
            { lastBuiltRevision: { SHA1: 'abc', branch: [{ name: 'refs/remotes/origin/feat/x' }] } },
          ],
        }),
      ),
    );
    expect(await c.getRevision('b')).toEqual({ commit: 'abc', branch: 'feat/x' });
    expect(
      await client(fakeFetch(() => json({ actions: [{ lastBuiltRevision: {} }] }))).getRevision('b'),
    ).toEqual({});
    expect(await client(fakeFetch(() => json({}))).getRevision('b')).toEqual({});
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'notFound'],
    [500, 'http'],
  ])('maps HTTP %d to %s', async (status, kind) => {
    const err = await client(fakeFetch(() => new Response('', { status })))
      .listViewsWithJobs()
      .catch((e) => e);
    expect(err).toBeInstanceOf(JenkinsError);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
  });

  it('maps fetch failures to network errors', async () => {
    const err = await client(fakeFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))))
      .listViewsWithJobs()
      .catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.message).toContain('ENOTFOUND');
  });

  it('treats an HTML login page as an auth problem', async () => {
    const err = await client(fakeFetch(() => new Response('<html>', { status: 200 })))
      .listViewsWithJobs()
      .catch((e) => e);
    expect(err.kind).toBe('auth');
  });
});

describe('stage helpers', () => {
  const stages = [
    { name: 'a', status: 'SUCCESS' },
    { name: 'b', status: 'FAILED' },
    { name: 'c', status: 'PAUSED_PENDING_INPUT' },
  ];
  it('finds failed and paused stages', () => {
    expect(firstFailedStage(stages)?.name).toBe('b');
    expect(pausedStage(stages)?.name).toBe('c');
    expect(firstFailedStage([])).toBeUndefined();
  });
});
