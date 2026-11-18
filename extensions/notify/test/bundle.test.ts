import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('Notify editor bundle', () => {
  it('leaves out the product table in @hmcts-cft/notify-tools/products', async () => {
    const result = await esbuild.build({
      absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
      entryPoints: ['src/webview/editor.ts'],
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
