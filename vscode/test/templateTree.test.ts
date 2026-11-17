import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inferSchema, schemaPaths } from '../src/schema';
import { CachedTemplateReader, LibraryMissingError, libraryPathFor, readInstructionTree } from '../src/templateTree';
import type { InstructionNode } from '../src/tree';

const LIBRARY = process.env.DOCMOSIS_LIB ?? join(__dirname, '../../lib/docx.mjs');

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

describe('libraryPathFor', () => {
  it('finds the library at ../lib relative to the CLI script', () => {
    expect(libraryPathFor('/ws/bin/docmosis')).toBe('/ws/lib/docx.mjs');
  });
});

describe('readInstructionTree', () => {
  it('explains how to fix a missing library', async () => {
    await expect(readInstructionTree('x.docx', '/nonexistent/lib/docx.mjs')).rejects.toThrow(LibraryMissingError);
  });

  describe.skipIf(!existsSync(LIBRARY))('with the docmosis library', () => {
    it('reads a synthetic template into a tree the schema module understands', async () => {
      const file = docx([
        'Ref <<referenceNumber>>',
        '<<cs_isEngland>>England<<es_>>',
        "<<{dateFormat(issued,'d MMMM yyyy','yyyy-MM-dd')}>>",
        '<<rs_defendants>><<name>> <<address.line1>><<es_>>',
      ]);
      const { root, warnings } = inferSchema(await readInstructionTree(file, LIBRARY));
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
    const [a, b] = await Promise.all([reader.read('/lib.mjs'), reader.read('/lib.mjs')]);
    const c = await reader.read('/lib.mjs');
    expect(reads()).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('reads again when the file or the library path changes', async () => {
    const { file, reader, reads } = setup();
    const first = await reader.read('/lib.mjs');
    writeFileSync(file, 'longer content');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const second = await reader.read('/lib.mjs');
    expect(second).not.toBe(first);
    await reader.read('/other.mjs');
    expect(reads()).toBe(3);
  });

  it("doesn't cache a failed read", async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tp-cache-')), 'T.docx');
    writeFileSync(file, 'x');
    let fail = true;
    const reader = new CachedTemplateReader(file, async () => {
      if (fail) throw new Error('bad zip');
      return [];
    });
    await expect(reader.read('/lib.mjs')).rejects.toThrow('bad zip');
    fail = false;
    await expect(reader.read('/lib.mjs')).resolves.toEqual([]);
  });
});
