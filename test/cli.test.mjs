// bin/docmosis.mjs, spawned.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
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

const SPAWN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: tmp, timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });

test('--help prints the usage to stderr and exits 0', () => {
    const r = run('--help');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /^usage: docmosis <command> \[args\]/);
    assert.match(r.stderr, /render-file <file\.docx> <data\.json>/);
    assert.match(r.stderr, /schema <template>/);
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
    const r = spawnSync(SHIM, ['text', fixture], { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Hello <<name>>/);
});

const spawned = (cmd, args, env) =>
    new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: tmp, env: { ...process.env, ...env } });
        const timer = setTimeout(() => child.kill('SIGKILL'), SPAWN_TIMEOUT_MS);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('close', (status, signal) => {
            clearTimeout(timer);
            resolve({ status, signal, stdout, stderr });
        });
    });

const listen = (handler) =>
    new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });

// A forward proxy as Node's fetch meets it: Node 24 tunnels even http:// targets through CONNECT,
// later versions send the absolute URI as an ordinary request. Both end at the handler.
const listenProxy = async (handler) => {
    const inner = http.createServer(handler);
    const outer = await listen(handler);
    outer.server.on('connect', (req, socket) => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        inner.emit('connection', socket);
    });
    return { port: outer.port, close: () => outer.server.close() };
};

const answerPdf = (res) => res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.7 ok');

test('render-file sends the data file exactly as written', { timeout: TEST_TIMEOUT_MS }, async () => {
    const raw = '{"amount": 100.00, "id": 12345678901234567890, "k": 1, "k": 2}';
    const dataFile = path.join(tmp, 'raw.json');
    fs.writeFileSync(dataFile, raw);
    const bodies = [];
    const { server, port } = await listen((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            bodies.push(Buffer.concat(chunks).toString('latin1'));
            answerPdf(res);
        });
    });
    try {
        const out = path.join(tmp, 'raw.pdf');
        const r = await spawned(process.execPath, [CLI, 'render-file', fixture, dataFile, '--out', out], { DOC_RENDER_URL: `http://127.0.0.1:${port}` });
        assert.equal(r.status, 0, r.stderr);
        assert.ok(bodies[0].includes(raw), 'the raw text is in the multipart body');
    } finally {
        server.close();
    }
});

test('a malformed DOC_RENDER_URL is a clean error', { timeout: TEST_TIMEOUT_MS }, async () => {
    const r = await spawned(process.execPath, [CLI, 'render-file', fixture, path.join(tmp, 'raw.json')], { DOC_RENDER_URL: 'not a url' });
    assert.equal(r.status, 1);
    assert.equal(r.stderr, 'the service URL is not a valid URL: not a url\n');
});

test('render-file goes through HTTP_PROXY from either entry point, however Node was started', { timeout: TEST_TIMEOUT_MS }, async () => {
    const seen = [];
    const { port, close } = await listenProxy((req, res) => {
        seen.push(new URL(req.url, `http://${req.headers.host}`).href);
        answerPdf(res);
    });
    try {
        const env = { HTTP_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: '', DOC_RENDER_URL: 'http://doc-render.invalid:8123' };
        for (const [cmd, args] of [
            [process.execPath, [CLI]],
            [SHIM, []],
        ]) {
            seen.length = 0;
            const r = await spawned(cmd, [...args, 'render-file', fixture, path.join(tmp, 'raw.json'), '--out', path.join(tmp, 'proxied.pdf')], env);
            assert.equal(r.status, 0, r.stderr);
            assert.deepEqual(seen, ['http://doc-render.invalid:8123/api/render'], cmd);
        }
    } finally {
        close();
    }
});

test('a signal to the launcher stops the Node it restarted', { timeout: TEST_TIMEOUT_MS, skip: process.platform === 'win32' }, async () => {
    const sockets = new Set();
    const { server, port } = await listen(() => {});
    server.on('connection', (s) => sockets.add(s));
    try {
        const child = spawn(process.execPath, [CLI, 'render-file', fixture, path.join(tmp, 'raw.json')], {
            cwd: tmp,
            env: { ...process.env, DOC_RENDER_URL: `http://127.0.0.1:${port}` },
            stdio: 'ignore',
        });
        const closed = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal })));
        while (sockets.size === 0) await new Promise((r) => setTimeout(r, 50));
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), SPAWN_TIMEOUT_MS);
        const r = await closed;
        clearTimeout(timer);
        assert.equal(r.signal, 'SIGTERM');
        const gone = await new Promise((resolve) => {
            const [socket] = sockets;
            if (socket.destroyed) return resolve(true);
            socket.on('close', () => resolve(true));
            setTimeout(() => resolve(false), 5000);
        });
        assert.ok(gone, 'the restarted Node closed its connection, so it is not orphaned');
    } finally {
        for (const s of sockets) s.destroy();
        server.close();
    }
});
