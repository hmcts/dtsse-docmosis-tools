// lib/render.mjs against an injected fetch; no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_URL, renderFile, RenderError, RenderUnreachable } from '../lib/render.mjs';

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
        assert.equal(e.dns, true);
        assert.equal(e.message, 'cannot resolve doc-render.aat.platform.hmcts.net');
        return true;
    });
    await assert.rejects(renderFile({ template: DOCX, data: {}, fetchImpl: failing('ECONNREFUSED') }), (e) => e instanceof RenderUnreachable && !e.dns);
    await assert.rejects(
        renderFile({ template: DOCX, data: {}, fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } }),
        RenderUnreachable,
    );
});

test('an unknown format is rejected before any request', async () => {
    await assert.rejects(renderFile({ template: DOCX, data: {}, format: 'rtf', fetchImpl: () => assert.fail('no request') }), TypeError);
});
