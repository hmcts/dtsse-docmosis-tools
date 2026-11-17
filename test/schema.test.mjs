// lib/schema.mjs on hand-built instruction trees, and `docmosis schema` on a synthetic .docx.
//
//   node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { pack } from '../lib/docx.mjs';
import { inferSchema, normaliseQuotes, schemaPaths, summarise } from '../lib/schema.mjs';

const field = (text, dataRefs = [text]) => ({ type: 'field', text, dataRefs, children: [] });
const cond = (text, dataRefs, children = []) => ({ type: 'condition', text, dataRefs, children });
const rep = (name, children = []) => ({ type: 'repeat', text: `rs_${name}`, dataRefs: [name], children });
const otherwise = (children) => ({ type: 'else', text: 'else', dataRefs: [], children });
const kinds = (root) => Object.fromEntries(schemaPaths(root).map((p) => [p.path, p.kind]));

test('plain fields are strings', () => {
    const { root, warnings } = inferSchema([field('caseRef')]);
    assert.deepEqual(root.properties.caseRef, { kind: 'string', controls: [], notes: [] });
    assert.deepEqual(warnings, []);
});

test('a bare condition makes a boolean and records the block that reads it', () => {
    const { root } = inferSchema([cond('cs_isEngland', ['isEngland'], [field('court')]), cond('cs_{!isWales}', ['isWales'])]);
    assert.deepEqual(root.properties.isEngland, { kind: 'boolean', controls: ['cs_isEngland'], notes: [] });
    assert.equal(root.properties.isWales.kind, 'boolean');
    assert.equal(root.properties.court.kind, 'string');
});

test('dateFormat makes a date and keeps the input format', () => {
    const { root } = inferSchema([field("{dateFormat(issueDate,'d MMMM yyyy','yyyy-MM-dd')}", ['issueDate']), field("{dateFormat(other,'d MMMM yyyy')}", ['other'])]);
    assert.deepEqual(root.properties.issueDate, { kind: 'date', controls: [], notes: [], inputFormat: 'yyyy-MM-dd' });
    assert.deepEqual(root.properties.other, { kind: 'date', controls: [], notes: [] });
});

test('typographic quotes are read as straight ones', () => {
    assert.equal(normaliseQuotes('‘a’ “b”'), `'a' "b"`);
    const { root } = inferSchema([field('{dateFormat(d,‘d MMMM yyyy’,‘dd/MM/yyyy’)}', ['d'])]);
    assert.equal(root.properties.d.inputFormat, 'dd/MM/yyyy');
});

test('dotted names nest into objects', () => {
    const { root } = inferSchema([field('claimant.address.line1'), field('claimant.name')]);
    assert.equal(root.properties.claimant.kind, 'object');
    assert.deepEqual(kinds(root), { 'claimant.address.line1': 'string', 'claimant.name': 'string' });
});

test('a repeat is an array whose item holds what is read inside it', () => {
    const { root } = inferSchema([rep('parties', [field('name'), cond('cs_isLead', ['isLead'])])]);
    const parties = root.properties.parties;
    assert.equal(parties.kind, 'array');
    assert.deepEqual(Object.keys(parties.item.properties), ['name', 'isLead']);
    assert.equal(parties.item.properties.isLead.kind, 'boolean');
    assert.deepEqual(kinds(root), { parties: 'array', 'parties[].name': 'string', 'parties[].isLead': 'boolean' });
    assert.deepEqual(summarise(root), { fields: 2, booleans: 1, dates: 0, repeats: 1, strings: 1 });
});

test('else branches are read in the enclosing scope', () => {
    const { root } = inferSchema([cond('cs_hasNotes', ['hasNotes'], [field('notes'), otherwise([field('fallback')])])]);
    assert.deepEqual(Object.keys(root.properties), ['hasNotes', 'notes', 'fallback']);
});

test('a name only tested for blank is weak: a later use decides its kind', () => {
    const { root } = inferSchema([cond('cs_{!isBlank(x)}', ['x']), field('x')]);
    assert.equal(root.properties.x.kind, 'string');
    assert.deepEqual(inferSchema([cond('cs_{!isBlank(y)}', ['y'])]).root.properties.y.notes, ['The template only tests whether this is blank or null.']);
});

test('conflicting uses give warnings and a widened or kept kind', () => {
    const widened = inferSchema([field("{dateFormat(d,'yyyy')}", ['d']), cond('cs_d', ['d'])]);
    assert.equal(widened.root.properties.d.kind, 'string');
    assert.deepEqual(widened.warnings, ['"d" is used as both date and boolean; widened to string.']);

    const kept = inferSchema([field('claimant.name'), field('claimant')]);
    assert.equal(kept.root.properties.claimant.kind, 'object');
    assert.deepEqual(kept.warnings, ['"claimant" is used as both string and object; kept as object.']);

    const repeated = inferSchema([field('items'), rep('items')]);
    assert.equal(repeated.root.properties.items.kind, 'array');
    assert.deepEqual(repeated.warnings, ['"items" is used as both string and a repeat; treated as a repeat.']);
});

test('differing date input formats warn and keep the first', () => {
    const { root, warnings } = inferSchema([field("{dateFormat(d,'yyyy','yyyy-MM-dd')}", ['d']), field("{dateFormat(d,'yyyy','dd/MM/yyyy')}", ['d'])]);
    assert.equal(root.properties.d.inputFormat, 'yyyy-MM-dd');
    assert.equal(warnings.length, 1);
});

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'docmosis.mjs');

const withDocx = (body, run) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmosis-schema-test-'));
    try {
        const src = path.join(tmp, 'src');
        fs.mkdirSync(path.join(src, 'word'), { recursive: true });
        fs.writeFileSync(path.join(src, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
        fs.writeFileSync(
            path.join(src, 'word', 'document.xml'),
            `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.map(p).join('')}</w:body></w:document>`,
        );
        const file = path.join(tmp, 'fixture.docx');
        pack(src, file);
        run(file);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
};

test('docmosis schema prints the inferred schema as JSON', () => {
    withDocx(
        ['<<cs_isEngland>>', '<<claimant.name>>', "<<{dateFormat(issueDate,'d MMMM yyyy','yyyy-MM-dd')}>>", '<<es_>>', '<<rs_items>>', '<<label>>', '<<es_>>'],
        (file) => {
            const out = JSON.parse(execFileSync(process.execPath, [CLI, 'schema', file], { encoding: 'utf8' }));
            assert.deepEqual(Object.keys(out), ['root', 'warnings']);
            assert.deepEqual(out.warnings, []);
            const { properties } = out.root;
            assert.deepEqual(properties.isEngland, { kind: 'boolean', controls: ['cs_isEngland'], notes: [] });
            assert.equal(properties.claimant.properties.name.kind, 'string');
            assert.equal(properties.issueDate.inputFormat, 'yyyy-MM-dd');
            assert.equal(properties.items.kind, 'array');
            assert.equal(properties.items.item.properties.label.kind, 'string');
        },
    );
});

test('docmosis schema rejects a missing file', () => {
    const r = spawnSync(process.execPath, [CLI, 'schema', '/nonexistent.docx'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.equal(r.stderr, 'schema needs a .docx file or an unpacked folder\n');
});
