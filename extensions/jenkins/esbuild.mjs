import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const config = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

if (watch) {
  await (await esbuild.context(config)).watch();
} else {
  await esbuild.build(config);
}
