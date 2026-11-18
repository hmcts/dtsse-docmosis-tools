import { describe, expect, it } from 'vitest';
import { parseWorkspaceYaml } from '../src/core/workspaceYaml';

describe('parseWorkspaceYaml', () => {
  it('reads apps, libs and platops entries', () => {
    const repos = parseWorkspaceYaml(`
# ---- apps ----
repos:
  apps/pcs/pcs-api: { url: hmcts/pcs-api }
  apps/ccd/ccd-data-store-api:
    url: hmcts/ccd-data-store-api
    ref: main
  libs/rse-cft-lib: { url: https://github.com/hmcts/rse-cft-lib.git }
  platops/flux: { url: "git@github.com:hmcts/cnp-flux-config.git" }
  apps/x/short: hmcts/short
`);
    expect(repos).toEqual([
      { path: 'apps/pcs/pcs-api', product: 'pcs', name: 'pcs-api', slug: 'hmcts/pcs-api' },
      {
        path: 'apps/ccd/ccd-data-store-api',
        product: 'ccd',
        name: 'ccd-data-store-api',
        slug: 'hmcts/ccd-data-store-api',
        ref: 'main',
      },
      { path: 'libs/rse-cft-lib', name: 'rse-cft-lib', slug: 'hmcts/rse-cft-lib' },
      { path: 'platops/flux', name: 'cnp-flux-config', slug: 'hmcts/cnp-flux-config' },
      { path: 'apps/x/short', product: 'x', name: 'short', slug: 'hmcts/short' },
    ]);
  });

  it('skips entries without a usable url', () => {
    const repos = parseWorkspaceYaml(`
repos:
  apps/a/one: {}
  apps/a/two: null
  apps/a/three: { url: 5 }
  apps/a/four: { url: not a repo }
  apps/a/five: { url: hmcts/five, ref: 3 }
  apps/a: { url: hmcts/short-path }
`);
    expect(repos.map((r) => r.path)).toEqual(['apps/a/five', 'apps/a']);
    expect(repos[0]?.ref).toBeUndefined();
    expect(repos[1]?.product).toBeUndefined();
  });

  it.each(['', 'repos: [a]', 'repos: 3', 'other: 1', ':\n  - [', 'null'])(
    'returns nothing for %j',
    (text) => {
      expect(parseWorkspaceYaml(text)).toEqual([]);
    },
  );
});
