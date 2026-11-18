import type { NotifyPreview, NotifyTemplate, Personalisation, TemplateType } from './notify.js';

export interface ApiKey {
    serviceId: string;
    secret: string;
}

/** Splits a Notify API key, `<name>-<service id>-<secret>`, or throws when it isn't one. */
export function parseApiKey(key: string): ApiKey;
/** An HS256 JWT with the service id as issuer and `nowMs` in seconds as the issue time. */
export function signToken(key: ApiKey, nowMs?: number): string;

export class NotifyApiError extends Error {
    constructor(message: string, status: number, errors?: { error: string; message: string }[]);
    readonly status: number;
    /** Notify's error list, when it sent one. */
    readonly errors: { error: string; message: string }[];
}

/** The environment variable that points the client at another Notify API, such as a local stand-in. */
export const NOTIFY_URL_ENV: 'HMCTS_TEMPLATE_PREVIEW_NOTIFY_URL';
/** The URL in NOTIFY_URL_ENV without trailing slashes, when it is set and not blank. */
export function notifyApiOverride(): string | undefined;
/** notifyApiOverride(), else the public Notify API. */
export function notifyApiUrl(): string;

export interface ClientOptions {
    /** Trailing slashes are dropped. Defaults to notifyApiUrl() when the client is made, also when empty or only slashes. */
    baseUrl?: string;
    fetchImpl?: typeof fetch;
}

/** The read-only part of the Notify API: templates can be listed, read and previewed, but not changed. */
export class NotifyClient {
    /** Throws when `apiKey` isn't a Notify API key. */
    constructor(apiKey: string, options?: ClientOptions);
    readonly serviceId: string;
    listTemplates(type?: TemplateType): Promise<NotifyTemplate[]>;
    getTemplate(id: string): Promise<NotifyTemplate>;
    /** Aborting `signal` rejects with the abort error rather than a "can't reach" one. */
    previewTemplate(id: string, personalisation: Personalisation, signal?: AbortSignal): Promise<NotifyPreview>;
}

/** A failure to read a secret, with a message to show a person. */
export class KeyVaultError extends Error {
    constructor(message: string);
}

/** The part of node:child_process execFile that readSecret calls. */
export type ExecFileLike = (
    file: string,
    args: string[],
    options: { timeout: number; windowsHide: boolean },
    callback: (error: (Error & { code?: string | number | null; killed?: boolean }) | null, stdout: string, stderr: string) => void,
) => unknown;

export interface ReadSecretOptions {
    execFileImpl?: ExecFileLike;
}

/**
 * Reads a secret with `az keyvault secret show` under the user's own login, without a shell. The
 * vault and secret names must match SAFE_NAME. Rejects with a KeyVaultError.
 */
export function readSecret(vault: string, secret: string, options?: ReadSecretOptions): Promise<string>;

/** Keeps keys read from Key Vault in memory for the session; nothing is written to disk. A failed read isn't kept. */
export class KeyStore {
    constructor(read?: (vault: string, secret: string) => Promise<string>);
    get(vault: string, secret: string): Promise<string>;
    has(vault: string, secret: string): boolean;
    forget(): void;
}
