import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { cliConfig } from '../esbuild.cli.mjs';

/** Builds only the CLI bundle and launchers that launcher.test.ts runs, away from dist/. */
export default async function setup(): Promise<() => void> {
  const dir = mkdtempSync(join(tmpdir(), 'docmosis-cli-'));
  await esbuild.build({ ...cliConfig(join(dir, 'docmosis-cli.mjs')), logLevel: 'silent' });
  copyFileSync('cli/docmosis', join(dir, 'docmosis'));
  process.env.DOCMOSIS_TEST_CLI_DIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
