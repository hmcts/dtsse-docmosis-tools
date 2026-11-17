// Renders a Docmosis template file on the hosted dtsse-doc-render.
//
// Nothing here prints or exits: renderFile resolves to the rendered bytes or throws
// RenderError (the service refused, or returned something that is not the requested format),
// RenderUnreachable (DNS, connection, TLS or socket failure, or a timeout) or RenderOptionError
// (an option that cannot be used, before any request is made).

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_URL = 'https://doc-render.aat.platform.hmcts.net';
export const FORMATS = ['pdf', 'docx', 'doc', 'odt', 'html', 'txt'];

const TIMEOUT_MS = 120_000;

// Failures that mean the host cannot be reached at all.
const UNREACHABLE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
// Failures after the host answered: a broken or intercepted TLS handshake, or a dropped
// socket. Behind the VPN these usually mean the VPN is down or something rewrites the traffic.
const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|UNABLE_TO_|CERT_|SELF_SIGNED_CERT_|DEPTH_ZERO_SELF_SIGNED_CERT)/;
const SOCKET_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET']);

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
    // code is the underlying error code, when there is one. tls is true when the host
    // answered but the TLS handshake or the socket failed, which points at the network path
    // rather than at the service being down.
    constructor(message, { url, code, tls = false, cause } = {}) {
        super(message, { cause });
        this.name = 'RenderUnreachable';
        this.url = url;
        this.code = code;
        this.tls = tls;
    }
}

export class RenderOptionError extends TypeError {
    constructor(message) {
        super(message);
        this.name = 'RenderOptionError';
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

function networkFailure(e, url, host) {
    const cause = e?.cause;
    const code = cause?.code ?? e?.code;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        return new RenderUnreachable(`request to ${url} timed out`, { url, cause: e });
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return new RenderUnreachable(`cannot resolve ${host} (${code})`, { url, code, cause: e });
    }
    if (UNREACHABLE_CODES.has(code)) return new RenderUnreachable(`cannot reach ${url} (${code})`, { url, code, cause: e });
    if (code && (TLS_CODE.test(code) || SOCKET_CODES.has(code))) {
        const detail = cause?.message && cause.message !== code ? `${code}: ${cause.message}` : code;
        return new RenderUnreachable(`TLS or network failure talking to ${url} (${detail}); the VPN or the network is probably at fault`, {
            url,
            code,
            tls: true,
            cause: e,
        });
    }
    return null;
}

function failureDetail(e) {
    const cause = e?.cause;
    const parts = [cause?.code, cause?.message].filter((v, i, all) => v && all.indexOf(v) === i);
    return parts.length ? `${e?.message ?? e} (${parts.join(': ')})` : String(e?.message ?? e);
}

const asBuffer = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v));

function serviceUrl(url) {
    const text = url || process.env.DOC_RENDER_URL || DEFAULT_URL;
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        throw new RenderOptionError(`the service URL is not a valid URL: ${text}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new RenderOptionError(`the service URL must start with http:// or https://: ${text}`);
    }
    return { text: text.replace(/\/+$/, ''), host: parsed.host };
}

/**
 * Exactly one of template and templatePath, and one of data and dataPath, is required.
 * @param {object} options
 * @param {Buffer | Uint8Array} [options.template] the .docx bytes
 * @param {string} [options.templatePath] a .docx file to read
 * @param {object} [options.data] the merge data, sent as JSON
 * @param {string} [options.dataPath] a JSON file, sent exactly as written
 * @param {string} [options.format] pdf (default), docx, doc, odt, html or txt
 * @param {boolean} [options.devMode] render field errors into the document instead of failing
 * @param {string} [options.url] the service; DOC_RENDER_URL when set and not empty, else the AAT instance
 * @param {string} [options.filename] the template's name in the request when template is bytes
 * @param {AbortSignal} [options.signal] aborting it cancels the request, which then rejects with the signal's reason
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function renderFile({
    template,
    templatePath,
    data,
    dataPath,
    format = 'pdf',
    devMode = false,
    url,
    filename,
    signal,
    fetchImpl = fetch,
}) {
    if (!FORMATS.includes(format)) throw new RenderOptionError(`format is one of: ${FORMATS.join(' ')}`);
    if ((template === undefined) === (templatePath === undefined)) {
        throw new RenderOptionError('give exactly one of template (bytes) and templatePath');
    }
    if ((data === undefined) === (dataPath === undefined)) throw new RenderOptionError('give exactly one of data (an object) and dataPath');
    if (data !== undefined && (typeof data !== 'object' || data === null)) {
        throw new RenderOptionError('data must be an object; use dataPath to send a JSON file');
    }
    const target = serviceUrl(url);
    const templateName = templatePath === undefined ? (filename ?? 'template.docx') : path.basename(templatePath);
    const templateBytes = templatePath === undefined ? asBuffer(template) : fs.readFileSync(templatePath);
    const dataText = dataPath === undefined ? JSON.stringify(data) : fs.readFileSync(dataPath, 'utf8');

    const form = new FormData();
    form.append('templateFile', new Blob([templateBytes]), templateName);
    form.append('data', new Blob([dataText], { type: 'application/json' }), 'data.json');
    form.append('outputFormat', format);
    form.append('devMode', String(Boolean(devMode)));

    let res;
    let bytes;
    try {
        res = await fetchImpl(`${target.text}/api/render`, {
            method: 'POST',
            body: form,
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
        });
        bytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
        if (signal?.aborted) throw e;
        throw networkFailure(e, target.text, target.host) ?? new RenderError(`request to ${target.text} failed: ${failureDetail(e)}`);
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
