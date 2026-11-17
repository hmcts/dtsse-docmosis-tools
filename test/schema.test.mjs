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
import { dataRefs, pack, readTemplate, templateInstructions, templateSchema } from '../lib/docx.mjs';
import { inferSchema, nodePaths, normaliseQuotes, resolveRef, schemaPaths, summarise } from '../lib/schema.mjs';

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

test('a repeat over a name that was only blank-tested replaces it without a warning', () => {
    const { root, warnings } = inferSchema([cond('cs_{!isBlank(items)}', ['items'], [rep('items', [field('label')])])]);
    assert.equal(root.properties.items.kind, 'array');
    assert.deepEqual(root.properties.items.notes, []);
    assert.deepEqual(warnings, []);
});

const BLANK = 'The template only tests whether this is blank or null.';
const blankTest = (name) => cond(`cs_{!isBlank(${name})}`, [name]);

test('the blank note stays only while blank tests are the sole use', () => {
    assert.deepEqual(inferSchema([blankTest('a')]).root.properties.a.notes, [BLANK]);
    assert.deepEqual(inferSchema([blankTest('a'), blankTest('a')]).root.properties.a.notes, [BLANK]);
});

test('a stronger use drops the blank note, whichever comes first', () => {
    const dateUse = field("{dateFormat(d,'d MMMM yyyy')}", ['d']);
    const afterDate = inferSchema([blankTest('d'), dateUse]).root.properties.d;
    assert.equal(afterDate.kind, 'date');
    assert.deepEqual(afterDate.notes, []);
    assert.deepEqual(inferSchema([field('f'), blankTest('f')]).root.properties.f.notes, []);
    assert.deepEqual(inferSchema([blankTest('f'), field('f')]).root.properties.f.notes, []);
    const nested = inferSchema([blankTest('p'), field('p.name')]);
    assert.equal(nested.root.properties.p.kind, 'object');
    assert.deepEqual(nested.root.properties.p.notes, []);
    assert.deepEqual(nested.warnings, []);
    const repeated = inferSchema([blankTest('items'), rep('items', [field('x')])]);
    assert.deepEqual(repeated.root.properties.items.notes, []);
    const reversed = inferSchema([rep('items', [field('x')]), blankTest('items')]);
    assert.deepEqual(reversed.root.properties.items.notes, []);
});

test('templateSchema infers from a template and matches the CLI output', () => {
    withDocx(['<<cs_isEngland>>', '<<name>>', '<<es_>>'], (file) => {
        const result = templateSchema(readTemplate(file));
        assert.equal(result.root.properties.isEngland.kind, 'boolean');
        assert.equal(result.root.properties.name.kind, 'string');
        assert.deepEqual(result, JSON.parse(execFileSync(process.execPath, [CLI, 'schema', file], { encoding: 'utf8' })));
    });
});

test('scope prefixes in dataRefs keep their prefix', () => {
    assert.deepEqual(dataRefs('$root.caseRef'), ['$root.caseRef']);
    assert.deepEqual(dataRefs("{dateFormat($parent.court.issued,'yyyy','yyyy-MM-dd')}"), ['$parent.court.issued']);
    assert.deepEqual(dataRefs('{$this.role + name}'), ['$this.role', 'name']);
    assert.deepEqual(dataRefs('rs_$parent.items'), ['$parent.items']);
    assert.deepEqual(dataRefs('$total = a'), ['a']);
});

test('$root, $parent and $this resolve against the scope stack', () => {
    const { root, warnings } = inferSchema([
        rep('parties', [field('name'), field('$root.caseRef', ['$root.caseRef']), field('$parent.court.name', ['$parent.court.name']), field('$this.role', ['$this.role'])]),
    ]);
    assert.deepEqual(Object.keys(root.properties).sort(), ['caseRef', 'court', 'parties']);
    assert.equal(root.properties.court.properties.name.kind, 'string');
    assert.deepEqual(Object.keys(root.properties.parties.item.properties).sort(), ['name', 'role']);
    assert.deepEqual(warnings, []);
});

test('$parent in a nested repeat is the next repeat out, and repeat targets take prefixes', () => {
    const { root, warnings } = inferSchema([
        rep('cases', [
            field('ref'),
            rep('parties', [field('$parent.ref', ['$parent.ref']), field('$parent.note', ['$parent.note']), field('$root.top', ['$root.top'])]),
            { type: 'repeat', text: 'rs_$root.extras', dataRefs: ['$root.extras'], children: [field('x')] },
        ]),
    ]);
    const cases = root.properties.cases.item.properties;
    assert.deepEqual(Object.keys(cases).sort(), ['note', 'parties', 'ref']);
    assert.deepEqual(Object.keys(cases.parties.item.properties), []);
    assert.equal(root.properties.top.kind, 'string');
    assert.equal(root.properties.extras.kind, 'array');
    assert.equal(root.properties.extras.item.properties.x.kind, 'string');
    assert.deepEqual(warnings, []);
});

test('scope prefixes work end to end from a .docx', () => {
    withDocx(
        ['<<rs_parties>>', '<<name>> <<$root.caseRef>> <<$parent.court.name>> <<$this.role>>', '<<es_>>'],
        (file) => {
            const { properties } = templateSchema(readTemplate(file)).root;
            assert.deepEqual(Object.keys(properties).sort(), ['caseRef', 'court', 'parties']);
            assert.deepEqual(Object.keys(properties.parties.item.properties).sort(), ['name', 'role']);
        },
    );
});

test('a filtered repeat opens a scope, so $parent in it is the enclosing scope and the rest of the filter is read per item', () => {
    const tree = [
        { type: 'repeat', text: 'rs_items.?[active]', dataRefs: ['items', 'active'], children: [field('$parent.caseRef'), field('name')] },
    ];
    const { root, warnings, refs } = inferSchema(tree);
    assert.deepEqual(Object.keys(root.properties).sort(), ['caseRef', 'items']);
    assert.deepEqual(Object.keys(root.properties.items.item.properties).sort(), ['active', 'name']);
    assert.deepEqual(refs.map((r) => r.paths), [['items', 'items[].active'], ['caseRef'], ['items[].name']]);
    assert.deepEqual(warnings, []);
});

test('an unnamed repeat over no list opens a scope with no schema path, and $root still reaches out', () => {
    const { root, refs, warnings } = inferSchema([
        { type: 'repeat', text: 'rs_{x}', dataRefs: [], children: [field('name'), field('$root.top')] },
    ]);
    assert.deepEqual(Object.keys(root.properties), ['top']);
    assert.deepEqual(refs.map((r) => r.paths), [['top']]);
    assert.equal(warnings.length, 1);
});

test('an index reads an item of the list, and an index on $this is not placed', () => {
    const { root, warnings, refs } = inferSchema([
        field('items[0].x'),
        field('tags[1]'),
        rep('rows', [field('$this[0].x'), field('$this.y')]),
    ]);
    assert.equal(root.properties.items.kind, 'array');
    assert.equal(root.properties.items.item.properties.x.kind, 'string');
    assert.equal(root.properties.tags.kind, 'array');
    assert.deepEqual(Object.keys(root.properties.rows.item.properties), ['y']);
    assert.deepEqual(warnings, ['"rows[][].x" indexes something that is not a list; ignored.']);
    assert.deepEqual(refs.map((r) => r.paths), [['items[].x'], ['tags'], ['rows'], ['rows[].y']]);
});

test('names written with spaces around the dot are recognised in conditions, dates, blank tests and repeat targets', () => {
    const { root } = inferSchema([
        cond('cs_$root . flag2', ['$root.flag2']),
        cond('cs_{ !$root . flag3 }', ['$root.flag3']),
        field("{dateFormat($root . d, 'd MMMM yyyy', 'yyyy-MM-dd')}", ['$root.d']),
        field('{isBlank($root . b)}', ['$root.b']),
        { type: 'repeat', text: 'rs_$root . extras', dataRefs: ['$root.extras'], children: [field('$this . id', ['$this.id'])] },
    ]);
    const p = root.properties;
    assert.equal(p.flag2.kind, 'boolean');
    assert.equal(p.flag3.kind, 'boolean');
    assert.equal(p.d.kind, 'date');
    assert.equal(p.d.inputFormat, 'yyyy-MM-dd');
    assert.equal(p.b.kind, 'string');
    assert.equal(p.extras.kind, 'array');
    assert.equal(p.extras.item.properties.id.kind, 'string');
});

test('a conflict warns once, by resolved path, across spellings', () => {
    const { warnings } = inferSchema([
        field("{dateFormat(x, 'd MMMM yyyy', 'yyyy-MM-dd')}", ['x']),
        field("{dateFormat($root.x, 'd MMMM yyyy', 'dd-MM-yyyy')}", ['$root.x']),
        field("{dateFormat($root . x, 'd MMMM yyyy', 'dd-MM-yyyy')}", ['$root.x']),
    ]);
    assert.deepEqual(warnings, ['"x" is read as a date in more than one input format (yyyy-MM-dd, dd-MM-yyyy); using yyyy-MM-dd.']);
});

test('the error index paths are all schema paths, in every scope', () => {
    const tree = [
        field('a.b'),
        rep('cases', [rep('$this.parties', [field('$parent.ref'), field('$root.top'), field('$this.n')])]),
        { type: 'repeat', text: 'rs_cases.?[x]', dataRefs: ['cases', 'x'], children: [field('$parent.y')] },
    ];
    const { root, refs } = inferSchema(tree);
    const known = new Set(nodePaths(root));
    for (const r of refs) for (const p of r.paths) assert.ok(known.has(p), p);
});

test('an else_ condition reads its names like a cs_ condition, and a bare else_ reads nothing', () => {
    const elseIf = (text, dataRefs, children = []) => ({ type: 'else', text, dataRefs, children });
    const { root, refs } = inferSchema([
        cond('cs_isEngland', ['isEngland'], [elseIf('else_isWales', ['isWales'], [field('w')]), elseIf('else_{n = 1}', ['n']), elseIf('else_', [])]),
    ]);
    assert.equal(root.properties.isWales.kind, 'boolean');
    assert.deepEqual(root.properties.isWales.controls, ['else_isWales']);
    assert.equal(root.properties.n.kind, 'string');
    assert.deepEqual(refs.map((r) => r.paths), [['isEngland'], ['isWales'], ['w'], ['n']]);
});

test('refs hold only schema paths', () => {
    const { root, refs } = inferSchema([
        cond('cs_address', ['address']),
        field('{address.line1}', ['address.line1']),
        rep('items', [field('{items.x}', ['items.x'])]),
        { type: 'repeat', text: 'rs_items', dataRefs: ['items'], children: [] },
    ]);
    const known = new Set(nodePaths(root));
    for (const r of refs) for (const p of r.paths) assert.ok(known.has(p), p);
    assert.ok(refs.every((r) => r.paths.length > 0));
    const objectRepeat = inferSchema([cond('cs_a', ['a']), field('a.b'), { type: 'repeat', text: 'rs_a', dataRefs: ['a'], children: [] }]);
    assert.deepEqual(objectRepeat.refs.map((r) => r.text), ['cs_a', 'a.b', 'rs_a']);
});

test('$parent outside any repeat reads nothing', () => {
    const { root, warnings, refs } = inferSchema([field('{$parent.x}', ['$parent.x']), field('y')]);
    assert.deepEqual(Object.keys(root.properties), ['y']);
    assert.deepEqual(warnings, ['`$parent.x` is outside any repeat, so it is always empty.']);
    assert.deepEqual(refs.map((r) => r.paths), [['y']]);
});

test('$parent inside a repeat that has no schema path reads nothing', () => {
    const { root, warnings } = inferSchema([
        { type: 'repeat', text: 'rs_{foo()}', dataRefs: [], children: [
            { type: 'repeat', text: 'rs_$root.agents', dataRefs: ['$root.agents'], children: [field('{$parent.x}', ['$parent.x'])] },
        ] },
    ]);
    assert.deepEqual(Object.keys(root.properties), ['agents']);
    assert.deepEqual(Object.keys(root.properties.agents.item.properties), []);
    assert.deepEqual(warnings, ["\"rs_{foo()}\" repeats over something the schema can't place, so the names inside it ($parent.x) are not in the form"]);
});

test('method arguments in an unnamed repeat are read in the enclosing scope, filter bodies per item', () => {
    const sub = inferSchema([{ type: 'repeat', text: 'rs_{items.subList(0, maxRows)}', dataRefs: ['items', 'maxRows'], children: [] }]);
    assert.deepEqual(kinds(sub.root), { items: 'array', maxRows: 'string' });
    const mixed = inferSchema([{ type: 'repeat', text: "rs_{items.?[kind == $root.want].subList(0, max)}", dataRefs: ['items', 'kind', '$root.want', 'max'], children: [] }]);
    assert.deepEqual(kinds(mixed.root), { items: 'array', 'items[].kind': 'string', want: 'string', max: 'string' });
});

test('a scalar read as a list warns the same way however it is spelled', () => {
    for (const second of [field('items[0].name'), rep('items')]) {
        const { root, warnings } = inferSchema([cond('cs_items', ['items']), second]);
        assert.equal(root.properties.items.kind, 'array');
        assert.deepEqual(warnings, []);
    }
    const { warnings } = inferSchema([field('items'), field('items[0].name')]);
    assert.deepEqual(warnings, ['"items" is used as both string and a repeat; treated as a repeat.']);
    assert.deepEqual(inferSchema([cond('cs_{!isBlank(items)}', ['items']), field('items[0].name')]).warnings, []);
});

const unplacedWarning = (text, names) => `"${text}" repeats over something the schema can't place, so the names inside it (${names}) are not in the form`;

test('a method call after a name in a filter body leaves the name per item', () => {
    const size = inferSchema([{ type: 'repeat', text: 'rs_{cases.?[parties.size() > 0]}', dataRefs: ['cases', 'parties'], children: [] }]);
    assert.deepEqual(kinds(size.root), { cases: 'array', 'cases[].parties': 'string' });
    const equals = inferSchema([{ type: 'repeat', text: "rs_{cases.?[type.equals('X')]}", dataRefs: ['cases', 'type'], children: [] }]);
    assert.deepEqual(kinds(equals.root), { cases: 'array', 'cases[].type': 'string' });
    const outer = inferSchema([{ type: 'repeat', text: 'rs_{cases.subList(0, rows.size())}', dataRefs: ['cases', 'rows'], children: [] }]);
    assert.deepEqual(kinds(outer.root), { cases: 'array', rows: 'string' });
});

test('names inside an unnamed repeat over an unplaceable list are warned about once, not dropped silently', () => {
    const { root, warnings, refs } = inferSchema([
        { type: 'repeat', text: 'rs_{$list}', dataRefs: [], children: [
            field('name'),
            rep('inner', [field('x')]),
            field('$root.top'),
            field('$this.role'),
        ] },
    ]);
    assert.deepEqual(Object.keys(root.properties), ['top']);
    assert.deepEqual(warnings, [unplacedWarning('rs_inner', 'x'), unplacedWarning('rs_{$list}', 'name, inner, $this.role')]);
    assert.deepEqual(refs.map((r) => r.paths), [['top']]);
});

test('$parent in an unplaceable repeat reads the real enclosing scope, and names in a repeat header count', () => {
    const { root, warnings } = inferSchema([
        rep('cases', [
            { type: 'repeat', text: 'rs_{$list}', dataRefs: [], children: [field('$parent.ref'), field('a')] },
        ]),
    ]);
    assert.deepEqual(Object.keys(root.properties.cases.item.properties), ['ref']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\(a\)/);
    const header = inferSchema([{ type: 'repeat', text: 'rs_{$list.?[flag]}', dataRefs: ['flag'], children: [] }]);
    assert.deepEqual(header.warnings, [unplacedWarning('rs_{$list.?[flag]}', 'flag')]);
});

test('refs keep an object or array path that a name widened', () => {
    const { refs } = inferSchema([cond('cs_address', ['address']), field('{address.line1}', ['address.line1'])]);
    assert.deepEqual(refs.map((r) => r.paths), [['address'], ['address.line1']]);
});

test('a condition on an indexed name records its control on the list', () => {
    const { root } = inferSchema([cond('cs_items[0]', ['items[0]'])]);
    assert.deepEqual(root.properties.items.controls, ['cs_items[0]']);
    const expr = inferSchema([cond('cs_{items[0] == 1}', ['items[0]'])]);
    assert.deepEqual(expr.root.properties.items.controls, ['cs_{items[0] == 1}']);
});

test('a prefix is only a prefix when no name character follows it', () => {
    assert.equal(resolveRef(['', 'a[]'], '$thisIsMine.x'), null);
    assert.equal(resolveRef(['', 'a[]'], '$parentCase.x'), null);
    assert.equal(resolveRef(['', 'a[]'], '$parent.x'), 'x');
    assert.equal(resolveRef(['', 'a[]'], '$this.x'), 'a[].x');
    const { root } = inferSchema([rep('a', [field('$thisIsMine.x'), field('$parentCase.x')])]);
    assert.deepEqual(kinds(root), { a: 'array' });
});

test('prefixes stay in dataRefs, and a user variable path is not a data name', () => {
    assert.deepEqual(dataRefs('{$myVar.name}'), []);
    assert.deepEqual(dataRefs('{$myVar[0].name + x}'), ['x']);
    assert.deepEqual(dataRefs('{$myVar.size() > n}'), ['n']);
    assert.deepEqual(dataRefs('{$thisIsMine.x}'), []);
    assert.deepEqual(dataRefs('{$root.a + $this.b + $parent.c}'), ['$root.a', '$this.b', '$parent.c']);
});

test('a repeat over an indexed element marks the list, warns, and treats the children as unplaceable', () => {
    const { root, warnings } = inferSchema([
        { type: 'repeat', text: 'rs_items[0]', dataRefs: ['items[0]'], children: [field('x')] },
    ]);
    assert.deepEqual(kinds(root), { items: 'array' });
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /list inside a list/);
    assert.equal(warnings[1], unplacedWarning('rs_items[0]', 'x'));
});

test('refs: false skips the instruction index, and templateInstructions flattens every part', () => {
    const tree = [field('a'), rep('rows', [field('b')])];
    assert.deepEqual(inferSchema(tree, { refs: false }).refs, []);
    assert.deepEqual(inferSchema(tree, { refs: false }).root, inferSchema(tree).root);
    withDocx(['<<a>>', '<<rs_rows>>', '<<b>>', '<<es_>>'], (file) => {
        const nodes = templateInstructions(readTemplate(file));
        assert.deepEqual(nodes.map((n) => n.text), ['a', 'rs_rows']);
    });
});

test('a later date use that names an input format fills one the first left out, and never removes one', () => {
    const named = inferSchema([field("{dateFormat(d,'d MMMM yyyy')}", ['d']), field("{dateFormat(d,'d MMM','dd/MM/yyyy')}", ['d'])]);
    assert.equal(named.root.properties.d.inputFormat, 'dd/MM/yyyy');
    assert.deepEqual(named.warnings, []);
    const kept = inferSchema([field("{dateFormat(d,'d MMM','dd/MM/yyyy')}", ['d']), field("{dateFormat(d,'d MMMM yyyy')}", ['d'])]);
    assert.equal(kept.root.properties.d.inputFormat, 'dd/MM/yyyy');
});

test('cr_ rows, repeats named twice, nested and dotted repeats, comments and boolean tests of lists and objects', () => {
    assert.deepEqual(inferSchema([cond('cr_hasRow', ['hasRow'], [], true)]).root.properties.hasRow, { kind: 'boolean', controls: ['cr_hasRow'], notes: [] });
    assert.deepEqual(kinds(inferSchema([rep('rows', [field('a')]), rep('rows', [field('b')])]).root), { rows: 'array', 'rows[].a': 'string', 'rows[].b': 'string' });
    assert.deepEqual(kinds(inferSchema([rep('claim.parties', [field('name'), rep('docs', [field('title')])])]).root), {
        'claim.parties': 'array',
        'claim.parties[].name': 'string',
        'claim.parties[].docs': 'array',
        'claim.parties[].docs[].title': 'string',
    });
    assert.deepEqual(inferSchema([{ type: 'comment', text: '/* note */', dataRefs: [], children: [] }]).root.properties, {});
    const tested = inferSchema([cond('cs_rows', ['rows']), rep('rows', [field('a')]), cond('cs_obj', ['obj']), field('obj.x')]);
    assert.equal(tested.root.properties.rows.kind, 'array');
    assert.equal(tested.root.properties.obj.kind, 'object');
    assert.deepEqual(tested.warnings, []);
});

test('a date used as a string widens without its input format, and a repeated conflict warns once', () => {
    const { root, warnings } = inferSchema([field("{dateFormat(d,'yyyy','yyyy-MM-dd')}", ['d']), field('d'), field('d')]);
    assert.deepEqual(root.properties.d, { kind: 'string', controls: [], notes: [] });
    assert.equal(warnings.length, 1);
});
