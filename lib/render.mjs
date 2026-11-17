// Renders a Docmosis template file on the hosted dtsse-doc-render.
//
// Nothing here prints or exits: renderFile resolves to the rendered bytes or throws
// RenderError (the service refused, or returned something that is not the requested format)
// or RenderUnreachable (DNS or connection failure, or a timeout).

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_URL = 'https://doc-render.aat.platform.hmcts.net';
export const FORMATS = ['pdf', 'docx', 'doc', 'odt', 'html', 'txt'];

const TIMEOUT_MS = 120_000;
const UNREACHABLE_CODES = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
]);
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

export class RenderError extends Error {
    // status is the HTTP status; shortMsg and longMsg are the service's, when it sent them;
    // lines is what to show a person: the distinct lines of those messages, or the start of
    // the body, or the start of an output that is not the requested format.
    constructor(message, { status = 0, shortMsg, longMsg, lines = [] } = {}) {
        super(message);
        this.name = 'RenderError';
        this.status = status;
        this.shortMsg = shortMsg;
        this.longMsg = longMsg;
        this.lines = lines;
    }
}

export class RenderUnreachable extends Error {
    // dns is true when the host name did not resolve.
    constructor(message, { url, dns = false, cause } = {}) {
        super(message, { cause });
        this.name = 'RenderUnreachable';
        this.url = url;
        this.dns = dns;
    }
}

const startsWith = (bytes, ...sig) => sig.every((b, i) => bytes[i] === b);

// Whether bytes hold a rendered document of the given format. html and txt have no magic
// bytes, so they are judged by content type.
export function isOutput(format, bytes, contentType = '') {
    const type = contentType.toLowerCase();
    switch (format) {
        case 'pdf':
            return startsWith(bytes, 0x25, 0x50, 0x44, 0x46);
        case 'docx':
        case 'odt':
            return startsWith(bytes, 0x50, 0x4b);
        case 'doc':
            return startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0);
        case 'html':
            return type.startsWith('text/html');
        case 'txt':
            return type.startsWith('text/plain');
        default:
            return false;
    }
}

function failureLines(bytes) {
    const body = bytes.subarray(0, 2000).toString('utf8');
    let json;
    try {
        json = JSON.parse(bytes.toString('utf8'));
    } catch {
        json = undefined;
    }
    const msgs = json && typeof json === 'object' ? [json.shortMsg, json.longMsg] : [];
    if (json && typeof json === 'object' && (json.shortMsg || json.longMsg)) {
        const seen = new Set();
        const lines = [];
        for (const m of msgs.filter(Boolean)) {
            for (const line of String(m).split('\n')) {
                if (!seen.has(line)) {
                    seen.add(line);
                    lines.push(line);
                }
            }
        }
        return { lines, shortMsg: json.shortMsg, longMsg: json.longMsg };
    }
    return { lines: body.split('\n') };
}

function networkFailure(e, url) {
    const code = e?.cause?.code ?? e?.code;
    const host = new URL(url).host;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        return new RenderUnreachable(`request to ${url} timed out`, { url, cause: e });
    }
    if (DNS_CODES.has(code)) return new RenderUnreachable(`cannot resolve ${host}`, { url, dns: true, cause: e });
    if (UNREACHABLE_CODES.has(code)) return new RenderUnreachable(`cannot reach ${url} (${code})`, { url, cause: e });
    return null;
}

const asBuffer = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v));

/**
 * @param {object} options
 * @param {Buffer | Uint8Array | string} options.template the .docx bytes, or a path to one
 * @param {object | string} options.data the merge data, or a path to a JSON file
 * @param {string} [options.format] pdf (default), docx, doc, odt, html or txt
 * @param {boolean} [options.devMode] render field errors into the document instead of failing
 * @param {string} [options.url] the service; DOC_RENDER_URL, else the AAT instance
 * @param {string} [options.filename] the template's name in the request when template is bytes
 * @param {AbortSignal} [options.signal] aborting it cancels the request, which then rejects with the signal's reason
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function renderFile({
    template,
    data,
    format = 'pdf',
    devMode = false,
    url = process.env.DOC_RENDER_URL ?? DEFAULT_URL,
    filename,
    signal,
    fetchImpl = fetch,
}) {
    if (!FORMATS.includes(format)) throw new TypeError(`format is one of: ${FORMATS.join(' ')}`);
    const templateName = typeof template === 'string' ? path.basename(template) : (filename ?? 'template.docx');
    const templateBytes = typeof template === 'string' ? fs.readFileSync(template) : asBuffer(template);
    const dataText = typeof data === 'string' ? fs.readFileSync(data, 'utf8') : JSON.stringify(data);

    const form = new FormData();
    form.append('templateFile', new Blob([templateBytes]), templateName);
    form.append('data', new Blob([dataText], { type: 'application/json' }), 'data.json');
    form.append('outputFormat', format);
    form.append('devMode', String(Boolean(devMode)));

    let res;
    let bytes;
    try {
        res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/render`, {
            method: 'POST',
            body: form,
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
        });
        bytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
        if (signal?.aborted) throw e;
        throw networkFailure(e, url) ?? new RenderError(`request to ${url} failed: ${e?.message ?? e}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || bytes.length === 0) {
        const { lines, shortMsg, longMsg } = failureLines(bytes);
        throw new RenderError(`render failed (HTTP ${res.status}):`, { status: res.status, shortMsg, longMsg, lines });
    }
    if (!isOutput(format, bytes, contentType)) {
        const start = bytes
            .subarray(0, 200)
            .toString('latin1')
            .replace(/[^\x20-\x7e\n]/g, '?')
            .replace(/\n+$/, '');
        throw new RenderError(
            `render failed: the response is not a ${format} (HTTP ${res.status}, content-type ${contentType || 'none'}); it starts:`,
            { status: res.status, lines: start.split('\n') },
        );
    }
    return { bytes, contentType, format };
}
