/** The bundled docmosis CLI, shared by the extension build and the launcher tests. */
export function cliConfig(outfile) {
  return {
    bundle: true,
    sourcemap: true,
    logLevel: 'info',
    entryPoints: ['../../packages/docmosis-tools/lib/cli.mjs'],
    outfile,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
  };
}
