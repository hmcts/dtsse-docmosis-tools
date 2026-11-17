import { chmod, copyFile, mkdir } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const common = { bundle: true, sourcemap: true, logLevel: 'info' };
const configs = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    // The docmosis template library is an ES module loaded by path at runtime.
    supported: { 'dynamic-import': true },
  },
  {
    ...common,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  },
  {
    ...common,
    entryPoints: ['test/integration/index.ts'],
    outfile: 'out-test/index.cjs',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
];

await mkdir('dist', { recursive: true });
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf.worker.min.mjs');
await copyFile('media/webview.css', 'dist/webview.css');
// The CLI and its library are packaged with the same relative layout as the repo.
await mkdir('cli/bin', { recursive: true });
await mkdir('cli/lib', { recursive: true });
await copyFile('../bin/docmosis', 'cli/bin/docmosis');
await chmod('cli/bin/docmosis', 0o755);
await copyFile('../lib/docx.mjs', 'cli/lib/docx.mjs');

if (watch) {
  for (const config of configs) await (await esbuild.context(config)).watch();
} else {
  await Promise.all(configs.map((config) => esbuild.build(config)));
}
