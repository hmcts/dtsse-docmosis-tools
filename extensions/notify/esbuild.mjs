import { copyFile, mkdir } from 'node:fs/promises';
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
  },
  ...[
    ['src/webview/picker.ts', 'dist/notify-picker.js'],
    ['src/webview/editor.ts', 'dist/notify-editor.js'],
  ].map(([entry, outfile]) => ({
    ...common,
    entryPoints: [entry],
    outfile,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  })),
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
await copyFile('media/webview.css', 'dist/webview.css');
await copyFile('media/notify.css', 'dist/notify.css');

if (watch) {
  for (const config of configs) await (await esbuild.context(config)).watch();
} else {
  await Promise.all(configs.map((config) => esbuild.build(config)));
}
