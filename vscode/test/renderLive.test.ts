import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { renderPdf } from '../src/render';

// Needs the VPN and a template: RENDER_LIVE_TEMPLATE=/path/to/01-plain-fields.docx npm test
const template = process.env.RENDER_LIVE_TEMPLATE;

it.skipIf(!template)('renders a template on the real dtsse-doc-render', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'tp-live-'));
  const result = await renderPdf({ docx: template!, data: {}, dev: true, outDir });
  expect(Buffer.from(result.bytes.subarray(0, 4)).toString()).toBe('%PDF');
  expect((await readFile(result.pdfPath)).length).toBe(result.bytes.length);
}, 120_000);
