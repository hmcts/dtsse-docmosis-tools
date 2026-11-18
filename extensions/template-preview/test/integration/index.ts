import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
  const workspace = process.env.TEST_WORKSPACE!;
  assert.ok(workspace, 'TEST_WORKSPACE is set by the runner');

  const extension = vscode.extensions.getExtension('hmcts.hmcts-template-preview');
  assert.ok(extension, 'extension is installed in the test host');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('hmctsTemplatePreview.preview'));
  assert.ok(commands.includes('hmctsTemplatePreview.searchTemplates'), 'the Templates view registers its commands');

  if (process.platform !== 'win32') {
    // A terminal opened after activation finds the stub in the extension's stable storage directory,
    // and the stub reaches the bundled launcher on both the system Node and VS Code's own.
    const found = join(workspace, 'terminal-which.txt');
    const script = [
      `echo "WHICH=$(command -v docmosis)" > '${found}'`,
      `docmosis --help 2>&1 | head -n 1 | sed 's/^/SYSTEM=/' >> '${found}'`,
      `DOCMOSIS_FORCE_VSCODE_NODE=1 docmosis --help 2>&1 | head -n 1 | sed 's/^/EDITOR=/' >> '${found}'`,
      `echo DONE >> '${found}'`,
    ].join('; ');
    const terminal = vscode.window.createTerminal({ name: 'docmosis-check', shellPath: '/bin/sh', shellArgs: ['-c', script] });
    await until(() => existsSync(found) && readFileSync(found, 'utf8').includes('DONE'), 'the terminal to run docmosis');
    terminal.dispose();
    const lines = readFileSync(found, 'utf8').split('\n');
    const marker = (name: string) => lines.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
    assert.ok(
      marker('WHICH')?.endsWith(join('globalStorage', 'hmcts.hmcts-template-preview', 'bin', 'docmosis')),
      `docmosis resolves to the stub in global storage: ${marker('WHICH')}`,
    );
    assert.match(marker('SYSTEM') ?? '', /^usage: docmosis <command>/, 'the system Node runs the launcher');
    assert.match(marker('EDITOR') ?? '', /^usage: docmosis <command>/, "VS Code's Node runs the launcher");
    console.log('integration: terminal command passed');
  }

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

  // The extension host is this process, so the in-process render client reads this URL.
  let requests = 0;
  const service = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requests++;
      response.writeHead(200, { 'content-type': 'application/pdf' }).end(MINIMAL_PDF);
    });
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  process.env.DOC_RENDER_URL = `http://127.0.0.1:${(service.address() as { port: number }).port}`;

  await vscode.commands.executeCommand('hmctsTemplatePreview.preview', vscode.Uri.file(docx));
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom, 'the preview opens as a custom editor');
  assert.equal(input.viewType, 'hmctsTemplatePreview.docxPreview');

  // The webview announces itself, receives the schema, then asks the host to render.
  const sidecar = join(workspace, '.hmcts-template-preview', 'Synthetic', 'default.json');
  await until(() => requests > 0 && existsSync(sidecar), 'the webview to request a render');
  service.close();
  assert.equal(readFileSync(join(workspace, '.hmcts-template-preview', '.gitignore'), 'utf8'), '*\n');
  console.log('integration: webview round trip passed');
}
