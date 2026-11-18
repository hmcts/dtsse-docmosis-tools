import type { FetchLike } from '../src/library/github';

export interface Call {
  url: string;
  headers: Record<string, string>;
}

type Route = (call: Call) => Response | Promise<Response>;

/** A fetch that answers from `routes`, keyed by the URL's path and query, and records each call. */
export function fakeFetch(routes: Record<string, Route>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    const call = { url, headers: init.headers };
    calls.push(call);
    const { pathname, search } = new URL(url);
    const route = routes[pathname + search];
    if (!route) return new Response('{"message":"Not Found"}', { status: 404 });
    return route(call);
  };
  return Object.assign(fetch, { calls });
}

export const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

export const blobEntry = (path: string, sha = `sha-${path}`, size = 100) => ({ path, mode: '100644', type: 'blob' as const, sha, size });
export const treeEntry = (path: string, sha: string) => ({ path, mode: '040000', type: 'tree' as const, sha });
