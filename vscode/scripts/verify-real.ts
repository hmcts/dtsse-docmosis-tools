// Manual check: infers the schema of real templates and renders one through the host's render path.
import { copyFile, mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverage } from '../src/coverage';
import type { JsonObject } from '../src/data';
import { renderPdf } from '../src/render';
import { inferSchema, schemaPaths, summarise } from '../src/schema';
import { libraryPathFor, readInstructionTree } from '../src/templateTree';

const [cli, payload, ...templates] = process.argv.slice(2);
if (!cli || !templates.length) throw new Error('usage: verify-real <docmosis-cli> <payload.json|-> <template.docx>...');

for (const template of templates) {
  const { root, warnings } = inferSchema(await readInstructionTree(template, libraryPathFor(cli)));
  const paths = schemaPaths(root);
  console.log(`\n${template.split('/').pop()}`, summarise(root), `warnings=${warnings.length}`);
  for (const kind of ['boolean', 'date', 'array', 'string'] as const) {
    console.log(`  ${kind}:`, paths.filter((p) => p.kind === kind).slice(0, 5).map((p) => p.path).join(', '));
  }
  for (const w of warnings.slice(0, 3)) console.log('  warning:', w);
  const controlled = Object.entries(root.properties).filter(([, s]) => s.controls.length).slice(0, 2);
  for (const [k, s] of controlled) console.log(`  ${k} controls`, s.controls);
  if (payload && payload !== '-') {
    const c = coverage(root, JSON.parse(await readFile(payload, 'utf8')) as JsonObject);
    console.log(`  coverage vs payload: missing=${c.missing.length} unused=${c.unused.length}`);
  }
}

if (payload && payload !== '-') {
  const outDir = join(tmpdir(), 'hmcts-template-preview-verify');
  await mkdir(outDir, { recursive: true });
  const template = templates[templates.length - 1]!;
  const data = JSON.parse(await readFile(payload, 'utf8')) as JsonObject;
  const result = await renderPdf({ cli, docx: template, data, dev: false, outDir, cwd: process.cwd(), log: (t) => process.stdout.write(`  | ${t}`) });
  const bytes = await readFile(result.pdfPath);
  console.log(`\nrendered ${result.pdfPath}: ${bytes.length} bytes, header ${bytes.subarray(0, 5).toString()}`);
  await copyFile(result.pdfPath, join(outDir, 'last.pdf'));
}
