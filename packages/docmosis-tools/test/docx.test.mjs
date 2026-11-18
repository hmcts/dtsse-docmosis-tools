// lib/docx.mjs against a synthetic template built here; no real template
// or payload is read.
//
//   node --test test/*.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { check, dataRefs, diff, DocxError, fields, instructionTree, pack, readTemplate, text, unpack, xmlProblem } from '../lib/docx.mjs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (...runs) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${esc(r)}</w:t></w:r>`).join('')}</w:p>`;
const row = (...cells) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`;
const doc = (...body) =>
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}</w:body></w:document>`;

const DOCUMENT = doc(
    p('Reference: <<caseRef>>'),
    p("Issued <<{dateFormat(issueDate,'d MMMM yyyy','yyyy-MM-dd')}>>"),
    p('<<cs_{!isBlank(notes)}>>'),
    p('Notes: <<notes>>'),
    p('<<else>>'),
    p('No notes for <<claimant>>'),
    p('<<es_>>'),
    '<w:tbl>',
    row('<<cr_showAmount>>', ''),
    row('Amount', '<<amount>>'),
    row('<<er_>>', ''),
    row('<<rr_items>>', ''),
    row('<<label>>', '<<{items.size() > 1 && ‘x’ != kind}>>'),
    row('<<er_>>', ''),
    '</w:tbl>',
    p('<<rs_parties>>'),
    p('<<name>> <<cs_{address != null}>><<address.line1>><<es_>>'),
    p('<<es_>>'),
    p('<</* reviewer note */>>'),
);
const HEADER = doc(p('<<op:headerTitle>>'));
const template = { parts: [{ name: 'word/document.xml', xml: DOCUMENT }, { name: 'word/header1.xml', xml: HEADER }] };

const summarise = (n) => ({ type: n.type, text: n.text, dataRefs: n.dataRefs, ...(n.row ? { row: true } : {}), children: n.children.map(summarise) });

test('instructionTree nests blocks, puts the else branch under its condition and derives dataRefs', () => {
    const [body, header] = instructionTree(template);
    assert.equal(body.part, 'word/document.xml');
    assert.deepEqual(body.children.map(summarise), [
        { type: 'field', text: 'caseRef', dataRefs: ['caseRef'], children: [] },
        { type: 'field', text: "{dateFormat(issueDate,'d MMMM yyyy','yyyy-MM-dd')}", dataRefs: ['issueDate'], children: [] },
        {
            type: 'condition',
            text: 'cs_{!isBlank(notes)}',
            dataRefs: ['notes'],
            children: [
                { type: 'field', text: 'notes', dataRefs: ['notes'], children: [] },
                { type: 'else', text: 'else', dataRefs: [], children: [{ type: 'field', text: 'claimant', dataRefs: ['claimant'], children: [] }] },
            ],
        },
        {
            type: 'condition',
            text: 'cr_showAmount',
            dataRefs: ['showAmount'],
            row: true,
            children: [{ type: 'field', text: 'amount', dataRefs: ['amount'], children: [] }],
        },
        {
            type: 'repeat',
            text: 'rr_items',
            dataRefs: ['items'],
            row: true,
            children: [
                { type: 'field', text: 'label', dataRefs: ['label'], children: [] },
                { type: 'field', text: '{items.size() > 1 && ‘x’ != kind}', dataRefs: ['items', 'kind'], children: [] },
            ],
        },
        {
            type: 'repeat',
            text: 'rs_parties',
            dataRefs: ['parties'],
            children: [
                { type: 'field', text: 'name', dataRefs: ['name'], children: [] },
                {
                    type: 'condition',
                    text: 'cs_{address != null}',
                    dataRefs: ['address'],
                    children: [{ type: 'field', text: 'address.line1', dataRefs: ['address.line1'], children: [] }],
                },
            ],
        },
        { type: 'comment', text: '/* reviewer note */', dataRefs: [], children: [] },
    ]);
    assert.deepEqual(header.children.map(summarise), [{ type: 'field', text: 'op:headerTitle', dataRefs: ['headerTitle'], children: [] }]);
});

test('tree nodes carry their location and a block its end', () => {
    const [body] = instructionTree(template);
    const amount = body.children[3];
    assert.deepEqual(amount.location, { part: 'word/document.xml', paragraph: 8, cells: [{ table: 1, row: 1, cell: 1 }], label: 'p8 t1.r1.c1' });
    assert.equal(amount.end.label, 'p12 t1.r3.c1');
    assert.equal(amount.children[0].fieldKind, '');
    assert.equal(body.children[1].fieldKind, 'expression');
});

test('dataRefs drops functions, literals, operators and variables', () => {
    assert.deepEqual(dataRefs("{dateFormat(issueDateSealed,'d MMMM yyyy','yyyy-MM-dd')}"), ['issueDateSealed']);
    assert.deepEqual(dataRefs('cs_{!isBlank(x)}'), ['x']);
    assert.deepEqual(dataRefs('{x != null}'), ['x']);
    assert.deepEqual(dataRefs('{a == ‘Yes’ || b == “No” || c == "z" || d == true}'), ['a', 'b', 'c', 'd']);
    assert.deepEqual(dataRefs('{$total + amount * 2}'), ['amount']);
    assert.deepEqual(dataRefs('$total = price'), ['price']);
    assert.deepEqual(dataRefs('rows[0].value'), ['rows[0].value']);
    assert.deepEqual(dataRefs('es_'), []);
    assert.deepEqual(dataRefs('else_{flag}'), ['flag']);
});

test('check reports unbalanced and crossed blocks without throwing, and the tree still builds', () => {
    const broken = { parts: [{ name: 'word/document.xml', xml: doc(p('<<cs_a>>'), p('<<cs_b>>'), p('<<es_a>>'), p('<<rs_open>>'), p('<<x')) }] };
    const result = check(broken);
    assert.ok(result.errors >= 3);
    assert.ok(result.problems.some((pr) => /the blocks cross/.test(pr.msg)));
    assert.ok(result.problems.some((pr) => /never closed/.test(pr.msg)));
    assert.ok(result.problems.some((pr) => /no closing ">>"/.test(pr.msg)));
    assert.equal(check(template).errors, 0);
    assert.equal(instructionTree(broken)[0].children[0].text, 'cs_a');
});

test('fields, text and diff return data', () => {
    const list = fields(template);
    assert.equal(list.find((f) => f.text === 'amount').depth, 1);
    const lines = text(template)[0].lines;
    assert.deepEqual(lines[0], { kind: 'para', loc: 'p1', text: 'Reference: <<caseRef>>' });
    assert.ok(lines.some((l) => l.kind === 'row' && l.text === 'Amount | <<amount>>'));

    const changed = { parts: [{ name: 'word/document.xml', xml: DOCUMENT.replace('&lt;&lt;caseRef&gt;&gt;', '&lt;&lt;claimRef&gt;&gt;') }, template.parts[1]] };
    const d = diff(template, changed);
    assert.deepEqual(d.added.map((x) => x.text), ['claimRef']);
    assert.deepEqual(d.removed.map((x) => x.text), ['caseRef']);
    assert.equal(d.oldCount, d.newCount);
});

test('readTemplate, unpack and pack round-trip a .docx', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmosis-docx-test-'));
    try {
        const src = path.join(tmp, 'src');
        fs.mkdirSync(path.join(src, 'word'), { recursive: true });
        fs.writeFileSync(path.join(src, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
        fs.writeFileSync(path.join(src, 'word', 'document.xml'), DOCUMENT);
        fs.writeFileSync(path.join(src, 'word', 'header1.xml'), HEADER);
        const file = path.join(tmp, 'fixture.docx');
        pack(src, file);
        assert.deepEqual(readTemplate(file).parts.map((x) => x.name), ['word/document.xml', 'word/header1.xml']);

        const dir = path.join(tmp, 'unpacked');
        unpack(file, dir);
        assert.match(fs.readFileSync(path.join(dir, 'word', 'document.xml'), 'utf8'), /\n<w:p>/);
        assert.deepEqual(instructionTree(dir).map(summarise), instructionTree(template).map(summarise));

        const again = path.join(tmp, 'again.docx');
        pack(dir, again);
        assert.deepEqual(fs.readFileSync(again), fs.readFileSync(file));

        fs.writeFileSync(path.join(dir, 'word', 'document.xml'), DOCUMENT.replace('</w:body>', ''));
        assert.throws(() => pack(dir, path.join(tmp, 'broken.docx')), (e) => e instanceof DocxError && e.exitCode === 1 && e.details.length === 1);
        assert.throws(() => readTemplate(path.join(tmp, 'missing.docx')), DocxError);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('a run whose rPr holds only lang or noProof counts as unformatted', () => {
    const run = (rpr, t) => `<w:r>${rpr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
    const xml = doc(`<w:p>${run('', '<<case')}${run('<w:rPr><w:lang w:val="en-GB"/><w:noProof/></w:rPr>', 'Ref>>')}</w:p>`);
    const result = check({ parts: [{ name: 'word/document.xml', xml }] });
    assert.ok(!result.problems.some((pr) => /different formatting/.test(pr.msg)), JSON.stringify(result.problems));
    const bold = doc(`<w:p>${run('', '<<case')}${run('<w:rPr><w:b/></w:rPr>', 'Ref>>')}</w:p>`);
    assert.ok(check({ parts: [{ name: 'word/document.xml', xml: bold }] }).problems.some((pr) => /different formatting/.test(pr.msg)));
});

test('a named end that crosses a block closes the innermost block of that name', () => {
    const xml = doc(p('<<cs_a>>'), p('<<cs_a>>'), p('<<cs_b>>'), p('<<es_a>>'), p('<<es_a>>'));
    const result = check({ parts: [{ name: 'word/document.xml', xml }] });
    assert.equal(result.errors, 1, JSON.stringify(result.problems));
    assert.match(result.problems[0].msg, /<<es_a>> closes <<cs_a>> \(p2\) while <<cs_b>> \(p3\) is still open/);
    assert.ok(!result.problems.some((pr) => /closes nothing/.test(pr.msg)));
});

test('xmlProblem flags unescaped & and <, and accepts entities, comments, CDATA and PIs', () => {
    assert.equal(xmlProblem('<?xml version="1.0"?><a b="&quot;x&amp;y&apos;"><!-- < & --><![CDATA[ < & ]]>&lt;&gt;&#38;&#x26;</a>'), null);
    assert.match(xmlProblem('<a>Smith & Jones</a>'), /"&" at offset 9 isn't an entity/);
    assert.match(xmlProblem('<a>&nbsp;</a>'), /"&" at offset 3/);
    assert.match(xmlProblem('<a b="x&y"/>'), /"&" at offset 7/);
    assert.match(xmlProblem('<a>1 < 2</a>'), /"<" at offset 5 doesn't start a tag/);
    assert.match(xmlProblem('<a>x<1</a>'), /"<" at offset 4/);
    assert.match(xmlProblem('<a><b></a>'), /<\/a> at offset 6 doesn't close/);
    assert.match(xmlProblem('<a><b/>'), /<a> is never closed/);
});

const fixture = (tmp) => {
    const src = path.join(tmp, 'src');
    fs.mkdirSync(path.join(src, 'word'), { recursive: true });
    fs.writeFileSync(path.join(src, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
    fs.writeFileSync(path.join(src, 'word', 'document.xml'), DOCUMENT);
    const file = path.join(tmp, 'fixture.docx');
    pack(src, file);
    const dir = path.join(tmp, 'unpacked');
    unpack(file, dir);
    return { file, dir };
};
const entries = (file) => execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('pack leaves the target untouched when the XML is broken', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmosis-docx-test-'));
    try {
        const { file, dir } = fixture(tmp);
        const before = fs.readFileSync(file);
        const xml = path.join(dir, 'word', 'document.xml');
        for (const broken of [DOCUMENT.replace('</w:body>', ''), DOCUMENT.replace('Reference:', 'Smith & Jones, Reference:')]) {
            fs.writeFileSync(xml, broken);
            assert.throws(() => pack(dir, file), (e) => e instanceof DocxError && e.exitCode === 1 && /was not written/.test(e.message));
            assert.deepEqual(fs.readFileSync(file), before);
            assert.deepEqual(fs.readdirSync(tmp).sort(), ['fixture.docx', 'src', 'unpacked']);
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('pack zips the recorded entries and new parts, and skips editor and OS junk', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmosis-docx-test-'));
    try {
        const { dir } = fixture(tmp);
        const add = (name, body = '<x/>') => {
            fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
            fs.writeFileSync(path.join(dir, name), body);
        };
        add('word/media/image9.png', 'png');
        add('customXml/item9.xml');
        for (const junk of ['word/document.xml~', 'word/.document.xml.swp', 'word/.DS_Store', '.DS_Store', 'notes.txt', 'word/Thumbs.db', 'scratch/edit.js']) add(junk);
        const out = path.join(tmp, 'out.docx');
        const { skipped } = pack(dir, out);
        assert.deepEqual(skipped.sort(), ['.DS_Store', 'notes.txt', 'scratch/edit.js', 'word/.DS_Store', 'word/.document.xml.swp', 'word/Thumbs.db', 'word/document.xml~']);
        assert.deepEqual(entries(out), ['[Content_Types].xml', 'word/document.xml', 'customXml/item9.xml', 'word/media/image9.png']);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// Docmosis Tornado rejects a row holding two of rr_, cr_ and er_ ("can't exist in the same
// table row as another"), and a cs_ or rs_ whose ends are in different cells of one row
// ("field is not matched"); a row block from one row to a later one renders.
test('row blocks span rows; a row with two rr_, cr_ or er_, or a cs_ across one row\'s cells, is an error', () => {
    const one = (...rows) => check({ parts: [{ name: 'word/document.xml', xml: doc(`<w:tbl>${rows.join('')}</w:tbl>`) }] });
    assert.deepEqual(one(row('<<rr_items>><<name>>', ''), row('<<er_>>', ''), row('<<cr_flag>>', '<<a>>'), row('', '<<er_>>')).problems, []);

    for (const rows of [
        [row('<<rr_items>><<name>>', '<<price>><<er_>>')],
        [row('<<rr_items>><<name>><<er_>>', '')],
        [row('<<cr_flag>><<a>>', '<<er_>>')],
    ]) {
        const result = one(...rows);
        assert.equal(result.errors, 1, JSON.stringify(result.problems));
        assert.match(result.problems[0].msg, /^<<er_>> is in the same table row as <<(rr_items|cr_flag)>> .* one rr_, cr_ or er_ per row\. A (rr|cr)_ block needs at least two rows/);
    }
    const crossed = one(row('<<cr_a>>', '<<cr_b>>'), row('<<er_>>', ''), row('<<er_>>', ''));
    assert.ok(crossed.problems.some((pr) => pr.level === 'error' && /^<<cr_b>> is in the same table row as <<cr_a>>/.test(pr.msg) && !/two rows/.test(pr.msg)), JSON.stringify(crossed.problems));

    const sections = one(row('<<cs_flag>><<a>>', '<<es_>>'), row('<<rs_items>>', '<<es_>>'), row('<<cs_x>><<b>><<es_>>', ''));
    assert.deepEqual(
        sections.problems.map((pr) => [pr.level, pr.msg.replace(/^.* start and end/, 'start and end').replace(/, which.*/, '')]),
        [
            ['error', 'start and end in different cells of the same row'],
            ['error', 'start and end in different cells of the same row'],
        ],
    );
});

test('a paragraph in a text box inside a run leaves the outer run reading text', () => {
    const t = (s) => `<w:t xml:space="preserve">${esc(s)}</w:t>`;
    const box = `<w:drawing><wp:inline><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r>${t('<<x>>')}</w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    const xml = doc(`<w:p><w:r>${t('A')}${box}${t('<<y>>')}</w:r></w:p>`);
    const tpl = { parts: [{ name: 'word/document.xml', xml }] };
    assert.deepEqual(fields(tpl).map((f) => f.text), ['x', 'y']);
    assert.deepEqual(text(tpl)[0].lines.map((l) => l.text), ['A<<y>>']);
    assert.equal(check(tpl).errors, 0);
});

test('a w:tab in a paragraph\'s tab stops is not text, and one in a run is', () => {
    const xml = doc(`<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>`);
    assert.deepEqual(text({ parts: [{ name: 'word/document.xml', xml }] })[0].lines, [{ kind: 'para', loc: 'p1', text: 'a\tb' }]);
});

const writeSource = (src) => {
    const put = (name, body) => {
        fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
        fs.writeFileSync(path.join(src, name), body);
    };
    put('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
    put('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    put('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    put('word/document.xml', DOCUMENT);
    put('word/header1.xml', HEADER);
    put('word/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
};
const NAMES = ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/header1.xml', 'word/media/image1.png'];

test('readTemplate reads stored and deflated entries of a zip made by zip', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmosis-docx-test-'));
    try {
        const src = path.join(tmp, 'src');
        writeSource(src);
        for (const level of ['-0', '-9']) {
            const file = path.join(tmp, `fixture${level}.docx`);
            execFileSync('zip', ['-q', '-X', level, file, ...NAMES], { cwd: src });
            assert.deepEqual(instructionTree(readTemplate(file)).map(summarise), instructionTree(template).map(summarise));
        }
        fs.writeFileSync(path.join(tmp, 'not.docx'), 'not a zip');
        assert.throws(() => readTemplate(path.join(tmp, 'not.docx')), (e) => e instanceof DocxError && /isn't a readable zip/.test(e.message));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('pack takes a folder made by plain unzip, _rels/.rels included, and writes a zip unzip accepts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmosis-docx-test-'));
    try {
        const src = path.join(tmp, 'src');
        writeSource(src);
        const original = path.join(tmp, 'original.docx');
        execFileSync('zip', ['-q', '-X', original, ...NAMES], { cwd: src });
        const plain = path.join(tmp, 'plain');
        execFileSync('unzip', ['-q', original, '-d', plain]);
        const out = path.join(tmp, 'out.docx');
        const { skipped } = pack(plain, out);
        assert.deepEqual(skipped, []);
        assert.deepEqual(entries(out), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/header1.xml', 'word/media/image1.png']);
        execFileSync('unzip', ['-tq', out]);
        for (const name of NAMES) {
            assert.deepEqual(execFileSync('unzip', ['-p', out, name.replace(/[[\]]/g, '\\$&')]), fs.readFileSync(path.join(src, name)), name);
        }

        const dir = path.join(tmp, 'unpacked');
        unpack(out, dir);
        assert.deepEqual(fs.readFileSync(path.join(dir, '_rels', '.rels')), fs.readFileSync(path.join(src, '_rels', '.rels')));
        assert.deepEqual(fs.readFileSync(path.join(dir, 'word', 'media', 'image1.png')), fs.readFileSync(path.join(src, 'word', 'media', 'image1.png')));
        const again = path.join(tmp, 'again.docx');
        pack(dir, again);
        assert.deepEqual(fs.readFileSync(again), fs.readFileSync(out));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
