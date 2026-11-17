// bin/docmosis.mjs, spawned.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pack } from '../lib/docx.mjs';

const CLI = fileURLToPath(new URL('../bin/docmosis.mjs', import.meta.url));
const SHIM = fileURLToPath(new URL('../bin/docmosis', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmosis-cli-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const src = path.join(tmp, 'src');
const put = (name, body) => {
    fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    fs.writeFileSync(path.join(src, name), body);
};
put('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
put('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>Hello &lt;&lt;name&gt;&gt;</w:t></w:r></w:p></w:body></w:document>`);
const fixture = path.join(tmp, 'fixture.docx');
pack(src, fixture);

const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: tmp });

test('--help prints the usage to stderr and exits 0', () => {
    const r = run('--help');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /^usage: docmosis <command> \[args\]/);
    assert.match(r.stderr, /render-file <file\.docx> <data\.json>/);
    assert.equal(r.stdout, '');
});

test('no command prints the usage and exits 2', () => {
    const r = run();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^usage: docmosis/);
});

test('an unknown command is an error', () => {
    const r = run('frobnicate');
    assert.equal(r.status, 1);
    assert.equal(r.stderr, 'unknown command frobnicate (see --help)\n');
});

test('an unknown option is an error', () => {
    const r = run('text', fixture, '--bogus');
    assert.equal(r.status, 1);
    assert.equal(r.stderr, 'unknown option --bogus (see --help)\n');
});

test('an unknown --format is an error', () => {
    const r = run('text', fixture, '--format', 'rtf');
    assert.equal(r.status, 1);
    assert.equal(r.stderr, '--format is one of: pdf docx doc odt html txt\n');
});

test('text prints the template text', () => {
    const r = run('text', fixture);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Hello <<name>>/);
});

test('fields, tree and check read the same file', () => {
    assert.match(run('fields', fixture).stdout, /<<name>>/);
    assert.equal(JSON.parse(run('tree', fixture).stdout)[0].children[0].text, 'name');
    const check = run('check', fixture);
    assert.equal(check.status, 0);
    assert.match(check.stdout, /1 instructions, 0 error\(s\), 0 warning\(s\)/);
});

test('a missing template names the command', () => {
    const r = run('text', path.join(tmp, 'nope.docx'));
    assert.equal(r.status, 1);
    assert.equal(r.stderr, 'text needs a .docx file or an unpacked folder\n');
});

test('render-file checks its arguments before any request', () => {
    assert.equal(run('render-file', fixture).stderr, 'render-file needs a .docx file and a data .json file\n');
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{');
    assert.equal(run('render-file', fixture, bad).stderr, `${bad} is not valid JSON\n`);
});

test('the bin/docmosis shim runs the Node CLI', () => {
    const r = spawnSync(SHIM, ['text', fixture], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Hello <<name>>/);
});
