import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = mkdtempSync(join(tmpdir(), 'tp-workspace-'));

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, 'out-test', 'index.cjs'),
  launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--disable-dev-shm-usage'],
  extensionTestsEnv: { TEST_WORKSPACE: workspace, DOCMOSIS_LIB: process.env.DOCMOSIS_LIB ?? join(root, '..', 'lib', 'docx.mjs') },
});
