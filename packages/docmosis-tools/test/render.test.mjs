// lib/render.mjs against an injected fetch; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_URL, renderFile, RenderError, RenderOptionError, RenderUnreachable } from '../lib/render.mjs';

const DOCX = Buffer.from('PK\x03\x04template');
const BODIES = {
    pdf: [Buffer.from('%PDF-1.7 rendered'), 'application/pdf'],
    docx: [Buffer.from('PK\x03\x04rendered'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    odt: [Buffer.from('PK\x03\x04rendered'), 'application/vnd.oasis.opendocument.text'],
    doc: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]), 'application/msword'],
    html: [Buffer.from('<html></html>'), 'text/html; charset=utf-8'],
    txt: [Buffer.from('Hello'), 'text/plain; charset=utf-8'],
};

const reply = (body, status = 200, type = 'application/octet-stream') =>
    new Response(body, { status, headers: { 'content-type': type } });

test('renderFile posts the multipart request and returns the bytes for every format', async () => {
    for (const [format, [body, type]] of Object.entries(BODIES)) {
        let seen;
        const fetchImpl = async (url, init) => {
            seen = { url, init };
            return reply(body, 200, type);
        };
        const result = await renderFile({ template: DOCX, data: { a: 1 }, format, devMode: true, url: 'http://svc/', fetchImpl });
        assert.deepEqual(result.bytes, body, format);
        assert.equal(result.format, format);
        assert.equal(result.contentType, type);
        assert.equal(seen.url, 'http://svc/api/render');
        assert.equal(seen.init.method, 'POST');
        const form = seen.init.body;
        assert.equal(form.get('outputFormat'), format);
        assert.equal(form.get('devMode'), 'true');
        assert.equal(form.get('templateFile').name, 'template.docx');
        assert.deepEqual(Buffer.from(await form.get('templateFile').arrayBuffer()), DOCX);
        assert.deepEqual(JSON.parse(await form.get('data').text()), { a: 1 });
    }
});

test('renderFile defaults to pdf, devMode false and the AAT service', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
        seen = { url, form: init.body };
        return reply(BODIES.pdf[0], 200, BODIES.pdf[1]);
    };
    const saved = process.env.DOC_RENDER_URL;
    delete process.env.DOC_RENDER_URL;
    try {
        await renderFile({ template: DOCX, data: {}, fetchImpl });
    } finally {
        if (saved !== undefined) process.env.DOC_RENDER_URL = saved;
    }
    assert.equal(seen.url, `${DEFAULT_URL}/api/render`);
    assert.equal(seen.form.get('outputFormat'), 'pdf');
    assert.equal(seen.form.get('devMode'), 'false');
});

test('a wrong magic byte is a RenderError that shows what came back', async () => {
    const fetchImpl = async () => reply('<html>login\x00page</html>', 200, 'text/html');
    await assert.rejects(renderFile({ template: DOCX, data: {}, format: 'pdf', fetchImpl }), (e) => {
        assert.ok(e instanceof RenderError);
        assert.equal(e.status, 200);
        assert.match(e.message, /not a pdf \(HTTP 200, content-type text\/html\)/);
        assert.deepEqual(e.lines, ['<html>login?page</html>']);
        return true;
    });
});

test('html and txt are judged by content type', async () => {
    const fetchImpl = async () => reply('hello', 200, 'application/json');
    for (const format of ['html', 'txt']) {
        await assert.rejects(renderFile({ template: DOCX, data: {}, format, fetchImpl }), RenderError);
    }
});

test('a 400 carries the service shortMsg and longMsg, without repeated lines', async () => {
    const body = JSON.stringify({ succeeded: false, shortMsg: 'Bad field', longMsg: 'Bad field\nline 3 of the template' });
    const fetchImpl = async () => reply(body, 400, 'application/json');
    await assert.rejects(renderFile({ template: DOCX, data: {}, fetchImpl }), (e) => {
        assert.ok(e instanceof RenderError);
        assert.equal(e.status, 400);
        assert.equal(e.shortMsg, 'Bad field');
        assert.equal(e.longMsg, 'Bad field\nline 3 of the template');
        assert.deepEqual(e.lines, ['Bad field', 'line 3 of the template']);
        assert.equal(e.message, 'render failed (HTTP 400):');
        return true;
    });
});

test('a failure that is not JSON shows the start of the body; an empty 200 is a failure', async () => {
    await assert.rejects(renderFile({ template: DOCX, data: {}, fetchImpl: async () => reply('Bad gateway', 502) }), (e) => {
        assert.equal(e.status, 502);
        assert.deepEqual(e.lines, ['Bad gateway']);
        return true;
    });
    await assert.rejects(renderFile({ template: DOCX, data: {}, fetchImpl: async () => reply('', 200) }), (e) => e instanceof RenderError && e.status === 200);
});

test('DNS and connection failures are RenderUnreachable', async () => {
    const failing = (code) => async () => {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
    };
    await assert.rejects(renderFile({ template: DOCX, data: {}, url: 'https://doc-render.aat.platform.hmcts.net', fetchImpl: failing('ENOTFOUND') }), (e) => {
        assert.ok(e instanceof RenderUnreachable);
        assert.equal(e.code, 'ENOTFOUND');
        assert.equal(e.tls, false);
        assert.equal(e.message, 'cannot resolve doc-render.aat.platform.hmcts.net (ENOTFOUND)');
        return true;
    });
    await assert.rejects(renderFile({ template: DOCX, data: {}, fetchImpl: failing('ECONNREFUSED') }), (e) => e instanceof RenderUnreachable && !e.tls && e.code === 'ECONNREFUSED');
    await assert.rejects(
        renderFile({ template: DOCX, data: {}, fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } }),
        RenderUnreachable,
    );
});

test('a signal is forwarded to the request and its abort is not reported as unreachable', async () => {
    const controller = new AbortController();
    let init;
    const fetchImpl = (url, i) => {
        init = i;
        return new Promise((_, reject) => i.signal.addEventListener('abort', () => reject(i.signal.reason)));
    };
    const pending = renderFile({ template: DOCX, data: {}, signal: controller.signal, fetchImpl });
    assert.equal(init.signal.aborted, false);
    controller.abort();
    await assert.rejects(pending, (e) => e.name === 'AbortError' && !(e instanceof RenderUnreachable));
    assert.equal(init.signal.aborted, true);
});

test('DOC_RENDER_URL is read on each call', async () => {
    const urls = [];
    const fetchImpl = async (url) => (urls.push(url), reply(BODIES.pdf[0], 200, 'application/pdf'));
    const saved = process.env.DOC_RENDER_URL;
    try {
        process.env.DOC_RENDER_URL = 'http://one';
        await renderFile({ template: DOCX, data: {}, fetchImpl });
        process.env.DOC_RENDER_URL = 'http://two';
        await renderFile({ template: DOCX, data: {}, fetchImpl });
    } finally {
        if (saved === undefined) delete process.env.DOC_RENDER_URL;
        else process.env.DOC_RENDER_URL = saved;
    }
    assert.deepEqual(urls, ['http://one/api/render', 'http://two/api/render']);
});

test('an unknown format is rejected before any request', async () => {
    await assert.rejects(renderFile({ template: DOCX, data: {}, format: 'rtf', fetchImpl: () => assert.fail('no request') }), TypeError);
});

const withEnv = async (value, fn) => {
    const saved = process.env.DOC_RENDER_URL;
    if (value === undefined) delete process.env.DOC_RENDER_URL;
    else process.env.DOC_RENDER_URL = value;
    try {
        return await fn();
    } finally {
        if (saved === undefined) delete process.env.DOC_RENDER_URL;
        else process.env.DOC_RENDER_URL = saved;
    }
};
const okFetch = (urls) => async (url) => (urls.push(url), reply(BODIES.pdf[0], 200, 'application/pdf'));

test('an empty DOC_RENDER_URL falls back to the default', async () => {
    const urls = [];
    await withEnv('', () => renderFile({ template: DOCX, data: {}, fetchImpl: okFetch(urls) }));
    assert.deepEqual(urls, [`${DEFAULT_URL}/api/render`]);
});

test('a malformed service URL is a RenderOptionError before any request, and the env var is checked too', async () => {
    const noRequest = () => assert.fail('no request');
    await assert.rejects(renderFile({ template: DOCX, data: {}, url: 'not a url', fetchImpl: noRequest }), (e) => {
        assert.ok(e instanceof RenderOptionError);
        assert.match(e.message, /not a valid URL: not a url/);
        return true;
    });
    await assert.rejects(withEnv('doc-render:8080', () => renderFile({ template: DOCX, data: {}, fetchImpl: noRequest })), RenderOptionError);
    await assert.rejects(renderFile({ template: DOCX, data: {}, url: 'ftp://host', fetchImpl: noRequest }), /http:\/\/ or https:\/\//);
});

test('TLS and socket failures say the VPN or network is at fault and keep the code', async () => {
    const failing = (code, message = code) => async () => {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
    };
    for (const code of ['ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UND_ERR_SOCKET', 'ECONNRESET']) {
        await assert.rejects(renderFile({ template: DOCX, data: {}, url: 'https://svc', fetchImpl: failing(code, 'detail text') }), (e) => {
            assert.ok(e instanceof RenderUnreachable, code);
            assert.equal(e.tls, true);
            assert.equal(e.code, code);
            assert.ok(e.message.includes(code) && e.message.includes('VPN or the network is probably at fault'), e.message);
            return true;
        });
    }
});

test('another fetch failure keeps the cause code and message in the error', async () => {
    const fetchImpl = async () => {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error('bad header'), { code: 'UND_ERR_INVALID_ARG' }) });
    };
    await assert.rejects(renderFile({ template: DOCX, data: {}, url: 'http://svc', fetchImpl }), (e) => {
        assert.ok(e instanceof RenderError);
        assert.equal(e.message, 'request to http://svc failed: fetch failed (UND_ERR_INVALID_ARG: bad header)');
        return true;
    });
});

test('template and data each take bytes or an object, or a path, and exactly one of the two', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-'));
    try {
        const docxPath = path.join(dir, 'My.docx');
        const dataPath = path.join(dir, 'd.json');
        fs.writeFileSync(docxPath, DOCX);
        fs.writeFileSync(dataPath, '{"amount": 100.00, "id": 12345678901234567890, "k": 1, "k": 2}');
        let form;
        const fetchImpl = async (url, init) => ((form = init.body), reply(BODIES.pdf[0], 200, 'application/pdf'));
        await renderFile({ templatePath: docxPath, dataPath, fetchImpl });
        assert.equal(form.get('templateFile').name, 'My.docx');
        assert.deepEqual(Buffer.from(await form.get('templateFile').arrayBuffer()), DOCX);
        assert.equal(await form.get('data').text(), '{"amount": 100.00, "id": 12345678901234567890, "k": 1, "k": 2}');

        await renderFile({ template: DOCX, data: { path: 'x' }, fetchImpl });
        assert.equal(await form.get('data').text(), '{"path":"x"}');

        const noRequest = () => assert.fail('no request');
        await assert.rejects(renderFile({ template: DOCX, templatePath: docxPath, data: {}, fetchImpl: noRequest }), RenderOptionError);
        await assert.rejects(renderFile({ data: {}, fetchImpl: noRequest }), RenderOptionError);
        await assert.rejects(renderFile({ template: DOCX, data: {}, dataPath, fetchImpl: noRequest }), RenderOptionError);
        await assert.rejects(renderFile({ template: DOCX, fetchImpl: noRequest }), RenderOptionError);
        await assert.rejects(renderFile({ template: DOCX, data: '/some/file.json', fetchImpl: noRequest }), /data must be an object/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
