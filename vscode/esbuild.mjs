import { copyFile, mkdir } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import { cliConfig } from './esbuild.cli.mjs';

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
    // The library's run-as-a-script guard reads import.meta.url and copes with it being absent.
    logOverride: { 'empty-import-meta': 'silent' },
  },
  cliConfig('dist/cli/docmosis-cli.mjs'),
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
await mkdir('dist/cli', { recursive: true });
await copyFile('cli/docmosis', 'dist/cli/docmosis');
await copyFile('cli/docmosis.cmd', 'dist/cli/docmosis.cmd');

if (watch) {
  for (const config of configs) await (await esbuild.context(config)).watch();
} else {
  await Promise.all(configs.map((config) => esbuild.build(config)));
}
