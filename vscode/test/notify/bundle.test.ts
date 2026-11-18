import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('Notify webview bundles', () => {
  it.each(['src/notify/webview/editor.ts', 'src/notify/webview/picker.ts'])("%s leaves out the products' vaults and secrets", async (entry) => {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      logLevel: 'silent',
    });
    expect(result.outputFiles[0]?.text).not.toContain('sptribs-aat');
  });
});
