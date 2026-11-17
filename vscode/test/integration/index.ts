import * as assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import * as vscode from 'vscode';

const MINIMAL_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

async function until(condition: () => boolean, what: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function run(): Promise<void> {
  const library = process.env.DOCMOSIS_LIB;
  const workspace = process.env.TEST_WORKSPACE!;
  assert.ok(workspace, 'TEST_WORKSPACE is set by the runner');

  const extension = vscode.extensions.getExtension('hmcts.hmcts-template-preview');
  assert.ok(extension, 'extension is installed in the test host');
  await extension.activate();
  assert.ok((await vscode.commands.getCommands(true)).includes('hmctsTemplatePreview.preview'));

  const docx = join(workspace, 'Synthetic.docx');
  writeFileSync(
    docx,
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&lt;&lt;cs_isEngland&gt;&gt;&lt;&lt;name&gt;&gt;&lt;&lt;es_&gt;&gt;</w:t></w:r></w:p></w:body></w:document>',
      ),
    }),
  );

  const cliDir = mkdtempSync(join(tmpdir(), 'tp-cli-'));
  mkdirSync(join(cliDir, 'bin'));
  const cli = join(cliDir, 'bin', 'docmosis');
  writeFileSync(
    cli,
    `#!/usr/bin/env bash\necho "$@" > "${cliDir}/args"\nwhile [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done\ncat > "$out" <<'PDF'\n${MINIMAL_PDF}PDF\n`,
  );
  chmodSync(cli, 0o755);
  if (library && existsSync(library)) {
    mkdirSync(join(cliDir, 'lib'));
    copyFileSync(library, join(cliDir, 'lib', 'docx.mjs'));
  }
  await vscode.workspace.getConfiguration('hmctsTemplatePreview').update('docmosisCli', cli, vscode.ConfigurationTarget.Global);

  await vscode.commands.executeCommand('hmctsTemplatePreview.preview', vscode.Uri.file(docx));
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom, 'the preview opens as a custom editor');
  assert.equal(input.viewType, 'hmctsTemplatePreview.docxPreview');

  if (!library || !existsSync(library)) {
    console.log('DOCMOSIS_LIB not set: skipped the webview round trip');
    return;
  }

  // The webview announces itself, receives the schema, then asks the host to render.
  const sidecar = join(workspace, '.hmcts-template-preview', 'Synthetic', 'default.json');
  await until(() => existsSync(join(cliDir, 'args')) && existsSync(sidecar), 'the webview to request a render');
  const args = readFileSync(join(cliDir, 'args'), 'utf8').trim().split(' ');
  assert.deepEqual(args.slice(0, 2), ['local', 'render']);
  assert.ok(args[2]!.endsWith('Synthetic.docx'));
  assert.equal(readFileSync(join(workspace, '.hmcts-template-preview', '.gitignore'), 'utf8'), '*\n');
  console.log('integration: webview round trip passed');
}
