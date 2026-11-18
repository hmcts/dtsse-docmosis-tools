import * as assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import * as vscode from 'vscode';

async function until(condition: () => boolean, what: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const SERVICE_ID = '26785a09-ab16-4eb0-8407-a37497a57506';
const TEMPLATE_ID = '9c8b7a6d-0000-4000-8000-000000000001';

/** Opens a Notify template against a local stand-in for the Notify API, with a fake az that prints a made-up key. */
export async function run(): Promise<void> {
  const workspace = process.env.TEST_WORKSPACE!;
  assert.ok(workspace, 'TEST_WORKSPACE is set by the runner');
  const extension = vscode.extensions.getExtension('hmcts.hmcts-notify');
  assert.ok(extension, 'extension is installed in the test host');
  await extension.activate();
  if (process.platform === 'win32') return;

  const bin = join(workspace, 'fake-az');
  mkdirSync(bin);
  const azArgs = join(workspace, 'az-args.txt');
  writeFileSync(
    join(bin, 'az'),
    `#!/bin/sh\necho "$*" > '${azArgs}'\necho "integration_test-${SERVICE_ID}-3d844edf-8d35-48ac-975b-e847b4f122b0"\n`,
  );
  chmodSync(join(bin, 'az'), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;

  const template = { id: TEMPLATE_ID, type: 'email', name: 'Smoke test', version: 1, subject: 'Hi ((name))', body: 'Dear ((name))' };
  const seen: { method: string; path: string; iss?: string }[] = [];
  const notify = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const token = (request.headers.authorization ?? '').replace(/^Bearer /, '');
      const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}') as { iss?: string };
      seen.push({ method: request.method!, path: request.url!, iss: claims.iss });
      const json = (value: unknown) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      if (request.url === '/v2/templates') return json({ templates: [template] });
      if (request.url === `/v2/template/${TEMPLATE_ID}`) return json(template);
      if (request.url === `/v2/template/${TEMPLATE_ID}/preview`) {
        const { personalisation } = JSON.parse(body) as { personalisation: { name: string } };
        return json({ ...template, subject: `Hi ${personalisation.name}`, body: `Dear ${personalisation.name}`, html: '<p>Dear</p>' });
      }
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => notify.listen(0, '127.0.0.1', resolve));
  process.env.HMCTS_NOTIFY_URL = `http://127.0.0.1:${(notify.address() as { port: number }).port}`;

  await vscode.workspace
    .getConfiguration('hmctsNotify')
    .update('products', [{ id: 'smoke', label: 'Smoke', vault: 'smoke-aat', secret: 'notify-key' }], vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('workbench.view.extension.hmctsNotify');
  await vscode.commands.executeCommand('hmctsNotify.openTemplate', 'smoke', TEMPLATE_ID);

  const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  await until(() => tabs().some((t) => t.label === 'Notify: Smoke test'), 'the template to open in an editor tab');
  const tab = tabs().find((t) => t.label === 'Notify: Smoke test');
  assert.ok(tab?.input instanceof vscode.TabInputWebview, 'the template opens in a webview panel');

  // The editor webview announces itself, the host reads the template, and the webview asks for Notify's preview.
  await until(() => seen.some((s) => s.method === 'POST' && s.path === `/v2/template/${TEMPLATE_ID}/preview`), 'the editor to request a preview');
  notify.close();
  assert.ok(seen.every((s) => s.iss === SERVICE_ID), 'every request is signed with the service id from the key');
  assert.equal(readFileSync(azArgs, 'utf8').trim(), 'keyvault secret show --vault-name smoke-aat --name notify-key --query value -o tsv');
  console.log('integration: Notify editor round trip passed');
}
