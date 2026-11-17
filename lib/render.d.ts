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
    constructor(message: string, details?: { url?: string; dns?: boolean; cause?: unknown });
    url?: string;
    dns: boolean;
}

export interface RenderOptions {
    /** The .docx bytes, or a path to one. */
    template: Buffer | Uint8Array | string;
    /** The merge data, or a path to a JSON file. */
    data: object | string;
    format?: RenderFormat;
    /** Render field errors into the document instead of failing. */
    devMode?: boolean;
    /** Defaults to DOC_RENDER_URL, else the AAT instance. */
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
