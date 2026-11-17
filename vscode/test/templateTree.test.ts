import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inferSchema, schemaPaths } from '../src/schema';
import { CachedTemplateReader, readInstructionTree, readTemplateSchema } from '../src/templateTree';
import type { InstructionNode } from '../src/tree';

function docx(paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('');
  const zip = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`),
  });
  const file = join(mkdtempSync(join(tmpdir(), 'tp-docx-')), 'Synthetic.docx');
  writeFileSync(file, zip);
  return file;
}


describe('readInstructionTree', () => {
  it('reads a synthetic template into a tree the schema module understands', async () => {
    const file = docx([
      'Ref <<referenceNumber>>',
      '<<cs_isEngland>>England<<es_>>',
      "<<{dateFormat(issued,'d MMMM yyyy','yyyy-MM-dd')}>>",
      '<<rs_defendants>><<name>> <<address.line1>><<es_>>',
    ]);
    const { root, warnings } = inferSchema(await readInstructionTree(file));
    expect(readTemplateSchema(file)).toEqual({ root, warnings });
    expect(warnings).toEqual([]);
    expect(Object.fromEntries(schemaPaths(root).map((p) => [p.path, p.kind]))).toEqual({
      referenceNumber: 'string',
      isEngland: 'boolean',
      issued: 'date',
      defendants: 'array',
      'defendants[].name': 'string',
      'defendants[].address.line1': 'string',
    });
  });
});

describe('CachedTemplateReader', () => {
  function setup() {
    const file = join(mkdtempSync(join(tmpdir(), 'tp-cache-')), 'T.docx');
    writeFileSync(file, 'one');
    let reads = 0;
    const reader = new CachedTemplateReader(file, async () => {
      reads++;
      return [] as InstructionNode[];
    });
    return { file, reader, reads: () => reads };
  }

  it('reads once while the file is unchanged, and returns the same tree', async () => {
    const { reader, reads } = setup();
    const [a, b] = await Promise.all([reader.read(), reader.read()]);
    const c = await reader.read();
    expect(reads()).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('reads again when the file changes', async () => {
    const { file, reader, reads } = setup();
    const first = await reader.read();
    writeFileSync(file, 'longer content');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const second = await reader.read();
    expect(second).not.toBe(first);
    expect(reads()).toBe(2);
  });

  it("doesn't cache a failed read", async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tp-cache-')), 'T.docx');
    writeFileSync(file, 'x');
    let fail = true;
    const reader = new CachedTemplateReader(file, async () => {
      if (fail) throw new Error('bad zip');
      return [];
    });
    await expect(reader.read()).rejects.toThrow('bad zip');
    fail = false;
    await expect(reader.read()).resolves.toEqual([]);
  });
});
