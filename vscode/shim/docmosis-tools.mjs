// TEMPORARY. Stands in for the @hmcts-cft/docmosis-tools package until it is on the repo root.
// aliases.mjs uses it only while ../package.json has no exports; delete this directory with it.
import fs from 'node:fs';

export * from '../../lib/docx.mjs';

export class RenderError extends Error {
  constructor(status, shortMsg, longMsg, lines) {
    super(shortMsg || longMsg || `render failed (HTTP ${status})`);
    this.name = 'RenderError';
    this.status = status;
    this.shortMsg = shortMsg;
    this.longMsg = longMsg;
    this.lines = lines;
  }
}

export class RenderUnreachable extends Error {
  constructor(url, cause) {
    super(`cannot reach ${url}`, { cause });
    this.name = 'RenderUnreachable';
  }
}

export async function renderFile({
  template,
  data,
  format = 'pdf',
  devMode = false,
  url = process.env.DOC_RENDER_URL ?? 'https://doc-render.aat.platform.hmcts.net',
  fetchImpl = fetch,
}) {
  const templateBytes = Buffer.isBuffer(template) ? template : fs.readFileSync(template);
  const json = typeof data === 'string' ? fs.readFileSync(data, 'utf8') : JSON.stringify(data);
  const form = new FormData();
  form.append('templateFile', new Blob([templateBytes]), 'template.docx');
  form.append('data', new Blob([json], { type: 'application/json' }), 'data.json');
  form.append('outputFormat', format);
  form.append('devMode', String(devMode));
  let response;
  try {
    response = await fetchImpl(`${url}/api/render`, { method: 'POST', body: form });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new RenderUnreachable(url, error);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status !== 200 || bytes.length === 0) {
    let shortMsg = '';
    let longMsg = '';
    try {
      ({ shortMsg = '', longMsg = '' } = JSON.parse(bytes.toString('utf8')));
    } catch {
      shortMsg = bytes.toString('utf8', 0, 2000);
    }
    const lines = [...new Set([shortMsg, ...longMsg.split('\n')].map((l) => l.trim()).filter(Boolean))];
    throw new RenderError(response.status, shortMsg, longMsg, lines);
  }
  return { bytes, contentType, format };
}
