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
    // The library's run-as-a-script guard reads import.meta.url and copes with it being absent.
    logOverride: { 'empty-import-meta': 'silent' },
  },
  {
    ...common,
    entryPoints: ['../lib/cli.mjs'],
    outfile: 'dist/cli/docmosis-cli.mjs',
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    // lib/docx.mjs runs its own main when it is the script; in the bundle that is never so.
    define: { 'import.meta.url': '"file:///bundled"' },
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
await mkdir('dist/cli', { recursive: true });
await copyFile('cli/docmosis', 'dist/cli/docmosis');
await chmod('dist/cli/docmosis', 0o755);
await copyFile('cli/docmosis.cmd', 'dist/cli/docmosis.cmd');

if (watch) {
  for (const config of configs) await (await esbuild.context(config)).watch();
} else {
  await Promise.all(configs.map((config) => esbuild.build(config)));
}
