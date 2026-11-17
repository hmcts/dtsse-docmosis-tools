export type RenderFormat = 'pdf' | 'docx' | 'doc' | 'odt' | 'html' | 'txt';

export const DEFAULT_URL: string;
export const FORMATS: readonly RenderFormat[];

export class RenderError extends Error {
    constructor(message: string, details?: { status?: number; shortMsg?: string; longMsg?: string; lines?: string[] });
    status: number;
    shortMsg?: string;
    longMsg?: string;
    lines: string[];
}

export class RenderUnreachable extends Error {
    constructor(message: string, details?: { url?: string; code?: string; tls?: boolean; cause?: unknown });
    url?: string;
    /** The underlying error code, such as ENOTFOUND or ERR_TLS_CERT_ALTNAME_INVALID. */
    code?: string;
    /** The host answered but the TLS handshake or the socket failed. */
    tls: boolean;
}

/** An option that cannot be used: an unknown format, a malformed service URL, or a missing or doubled template or data. */
export class RenderOptionError extends TypeError {}

export interface RenderOptions {
    /** The .docx bytes. Give this or templatePath. */
    template?: Buffer | Uint8Array;
    /** A .docx file to read. */
    templatePath?: string;
    /** The merge data, sent as JSON. Give this or dataPath. */
    data?: object;
    /** A JSON file, sent exactly as written. */
    dataPath?: string;
    format?: RenderFormat;
    /** Render field errors into the document instead of failing. */
    devMode?: boolean;
    /** Defaults to DOC_RENDER_URL when set and not empty, else the AAT instance. */
    url?: string;
    /** The template's file name in the request when template is bytes. */
    filename?: string;
    /** Aborting it cancels the request, which then rejects with the signal's reason. */
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
}

export interface RenderResult {
    bytes: Buffer;
    contentType: string;
    format: RenderFormat;
}

export function isOutput(format: RenderFormat, bytes: Uint8Array, contentType?: string): boolean;
export function renderFile(options: RenderOptions): Promise<RenderResult>;
