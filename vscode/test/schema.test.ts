import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { inferSchema, schemaPaths, summarise, type ObjectSchema } from '../src/schema';
import type { InstructionNode } from '../src/tree';
import { cond, field, otherwise, rep } from './helpers';

const kinds = (root: ObjectSchema) => Object.fromEntries(schemaPaths(root).map((p) => [p.path, p.kind]));

describe('inferSchema', () => {
  it('turns plain fields into strings', () => {
    const { root, warnings } = inferSchema([field('referenceNumber')]);
    expect(root.properties.referenceNumber).toMatchObject({ kind: 'string' });
    expect(warnings).toEqual([]);
  });

  it('nests dotted paths into objects', () => {
    const { root } = inferSchema([field('claimant.address.addressLine1'), field('claimant.name')]);
    const claimant = root.properties.claimant;
    expect(claimant?.kind).toBe('object');
    expect(kinds(root)).toEqual({
      'claimant.address.addressLine1': 'string',
      'claimant.name': 'string',
    });
  });

  it('makes dateFormat refs dates stored in the input format', () => {
    const { root } = inferSchema([field("{dateFormat(issueDateSealed,'d MMMM yyyy','yyyy-MM-dd')}", ['issueDateSealed'])]);
    expect(root.properties.issueDateSealed).toMatchObject({ kind: 'date', inputFormat: 'yyyy-MM-dd' });
  });

  it('uses a non-default input format when the template gives one', () => {
    const { root } = inferSchema([field("{dateFormat(d,'d MMMM yyyy','dd/MM/yyyy')}", ['d'])]);
    expect(root.properties.d).toMatchObject({ kind: 'date', inputFormat: 'dd/MM/yyyy' });
  });

  it('assumes no input format when dateFormat has two arguments', () => {
    const { root } = inferSchema([field("{dateFormat(d,'d MMMM yyyy')}", ['d'])]);
    expect(root.properties.d).toEqual({ kind: 'date', controls: [], notes: [] });
  });

  it('takes the input format from a later use that names one', () => {
    const { root, warnings } = inferSchema([
      field("{dateFormat(d,'d MMMM yyyy')}", ['d']),
      field("{dateFormat(d,'d MMM','dd/MM/yyyy')}", ['d']),
    ]);
    expect(root.properties.d).toMatchObject({ kind: 'date', inputFormat: 'dd/MM/yyyy' });
    expect(warnings).toEqual([]);
  });

  it('keeps a named input format when a later use names none', () => {
    const { root } = inferSchema([
      field("{dateFormat(d,'d MMM','dd/MM/yyyy')}", ['d']),
      field("{dateFormat(d,'d MMMM yyyy')}", ['d']),
    ]);
    expect(root.properties.d).toMatchObject({ kind: 'date', inputFormat: 'dd/MM/yyyy' });
  });

  it('makes a bare condition a boolean that controls its block', () => {
    const { root } = inferSchema([cond('cs_isEngland', ['isEngland'], [field('a')])]);
    expect(root.properties.isEngland).toMatchObject({ kind: 'boolean', controls: ['cs_isEngland'] });
    expect(root.properties.a).toMatchObject({ kind: 'string' });
  });

  it('treats cr_ conditional rows like conditions', () => {
    const { root } = inferSchema([cond('cr_hasRow', ['hasRow'], [], true)]);
    expect(root.properties.hasRow).toMatchObject({ kind: 'boolean', controls: ['cr_hasRow'] });
  });

  it('accepts braces, negation and dotted names on a bare condition', () => {
    const { root } = inferSchema([cond('cs_{!claimant.isOrg}', ['claimant.isOrg'])]);
    expect(kinds(root)).toEqual({ 'claimant.isOrg': 'boolean' });
  });

  it('makes isBlank and null tests strings with a note', () => {
    const { root } = inferSchema([
      cond('cs_{!isBlank(x)}', ['x']),
      cond('cs_{y != null}', ['y']),
    ]);
    for (const key of ['x', 'y']) {
      expect(root.properties[key]).toMatchObject({ kind: 'string' });
      expect(root.properties[key]?.notes).toHaveLength(1);
    }
    expect(root.properties.x?.controls).toEqual(['cs_{!isBlank(x)}']);
  });

  it('makes every ref of another expression a string', () => {
    const { root } = inferSchema([cond("cs_{a == 'Y' && b > 3}", ['a', 'b'])]);
    expect(kinds(root)).toEqual({ a: 'string', b: 'string' });
  });

  it('lets a real use replace a blank-test use of the same name', () => {
    const { root, warnings } = inferSchema([cond('cs_{!isBlank(x)}', ['x']), field('x')]);
    expect(root.properties.x).toMatchObject({ kind: 'string', controls: ['cs_{!isBlank(x)}'] });
    expect(warnings).toEqual([]);
  });

  it('keeps a boolean when the same name is only blank-tested as well', () => {
    const { root, warnings } = inferSchema([cond('cs_flag', ['flag']), cond('cs_{!isBlank(flag)}', ['flag'])]);
    expect(root.properties.flag).toMatchObject({ kind: 'boolean' });
    expect(warnings).toEqual([]);
  });

  it('turns repeats into arrays of objects from their nested fields', () => {
    const { root } = inferSchema([rep('defendants', [field('name'), field('address.line1'), cond('cs_isOrg', ['isOrg'])])]);
    const defendants = root.properties.defendants;
    expect(defendants?.kind).toBe('array');
    expect(kinds(root)).toEqual({
      defendants: 'array',
      'defendants[].name': 'string',
      'defendants[].address.line1': 'string',
      'defendants[].isOrg': 'boolean',
    });
  });

  it('supports nested repeats and dotted repeat names', () => {
    const { root } = inferSchema([rep('claim.parties', [field('name'), rep('docs', [field('title')])])]);
    expect(kinds(root)).toEqual({
      'claim.parties': 'array',
      'claim.parties[].name': 'string',
      'claim.parties[].docs': 'array',
      'claim.parties[].docs[].title': 'string',
    });
  });

  it('merges a repeat that appears twice', () => {
    const { root } = inferSchema([rep('rows', [field('a')]), rep('rows', [field('b')])]);
    expect(kinds(root)).toEqual({ rows: 'array', 'rows[].a': 'string', 'rows[].b': 'string' });
  });

  it('walks else branches in the same scope', () => {
    const { root } = inferSchema([cond('cs_flag', ['flag'], [field('yes'), otherwise([field('no')])])]);
    expect(kinds(root)).toEqual({ flag: 'boolean', yes: 'string', no: 'string' });
  });

  it('ignores comments', () => {
    const { root } = inferSchema([{ type: 'comment', text: '/* note */', dataRefs: [], children: [] }]);
    expect(root.properties).toEqual({});
  });

  it('widens a name used with two types to a string and warns', () => {
    const { root, warnings } = inferSchema([cond('cs_x', ['x']), field('x')]);
    expect(root.properties.x).toMatchObject({ kind: 'string', controls: ['cs_x'] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"x"');
  });

  it('widens date and string uses and drops the input format', () => {
    const { root, warnings } = inferSchema([field("{dateFormat(d,'yyyy','yyyy-MM-dd')}", ['d']), field('d')]);
    expect(root.properties.d).toEqual({ kind: 'string', controls: [], notes: [] });
    expect(warnings).toHaveLength(1);
  });

  it('does not repeat a warning', () => {
    const { warnings } = inferSchema([cond('cs_x', ['x']), field('x'), field('x')]);
    expect(warnings).toHaveLength(1);
  });

  it('accepts a boolean test on a repeat or object without warning', () => {
    const { root, warnings } = inferSchema([cond('cs_rows', ['rows']), rep('rows', [field('a')]), cond('cs_obj', ['obj']), field('obj.x')]);
    expect(root.properties.rows?.kind).toBe('array');
    expect(root.properties.obj?.kind).toBe('object');
    expect(warnings).toEqual([]);
  });

  it('keeps an object when a name is used both as a value and as a parent', () => {
    const { root, warnings } = inferSchema([field('claimant'), field('claimant.name')]);
    expect(root.properties.claimant?.kind).toBe('object');
    expect(warnings).toHaveLength(1);
  });

  it('warns when one date name has two input formats', () => {
    const { warnings } = inferSchema([
      field("{dateFormat(d,'yyyy','yyyy-MM-dd')}", ['d']),
      field("{dateFormat(d,'yyyy','dd/MM/yyyy')}", ['d']),
    ]);
    expect(warnings).toHaveLength(1);
  });
});

describe('summarise', () => {
  it('counts fields by kind and repeats separately', () => {
    const { root } = inferSchema([
      field('a'),
      cond('cs_b', ['b']),
      field("{dateFormat(c,'yyyy','yyyy-MM-dd')}", ['c']),
      rep('rows', [field('n')]),
    ]);
    expect(summarise(root)).toEqual({ fields: 4, booleans: 1, dates: 1, repeats: 1, strings: 2 });
  });
});

const STRUCTURE = '/tmp/pl-vm/v1-structure.json';

interface DocmosisNode {
  type: 'field' | 'condition' | 'repeat';
  text: string;
  dataRefs: string[];
  contains?: DocmosisNode[];
}

const convert = (n: DocmosisNode): InstructionNode => {
  const children = (n.contains ?? []).map(convert);
  return {
    type: n.type,
    text: n.text,
    dataRefs: n.dataRefs ?? [],
    children,
    ...(/^(cr|rr)_/.test(n.text) ? { row: true } : {}),
  };
};

describe.skipIf(!existsSync(STRUCTURE))("Docmosis's getTemplateStructure output", () => {
  let root: ReturnType<typeof inferSchema>['root'];
  let warnings: ReturnType<typeof inferSchema>['warnings'];
  let paths: ReturnType<typeof kinds>;

  beforeAll(() => {
    const raw = JSON.parse(readFileSync(STRUCTURE, 'utf8')) as { templateStructure: DocmosisNode[] };
    ({ root, warnings } = inferSchema(raw.templateStructure.map(convert)));
    paths = kinds(root);
  });

  it('finds the plain fields, dotted paths and conditions', () => {
    expect(paths.referenceNumber).toBe('string');
    expect(paths['claimant.address.addressLine1']).toBe('string');
    expect(paths.isEngland).toBe('boolean');
  });

  it('finds date expressions and repeats', () => {
    expect(paths.issueDateSealed).toBe('date');
    expect(Object.values(paths)).toContain('array');
    expect(Object.keys(paths).some((p) => p.includes('[]'))).toBe(true);
  });

  it('infers a plausible number of values and reports warnings as strings', () => {
    const counts = summarise(root);
    expect(counts.fields).toBeGreaterThan(20);
    expect(counts.booleans).toBeGreaterThan(0);
    expect(warnings.every((w) => typeof w === 'string')).toBe(true);
  });
});
