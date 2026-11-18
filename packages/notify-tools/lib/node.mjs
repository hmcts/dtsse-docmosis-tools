// The GOV.UK Notify API's read-only template calls, and Notify API keys read from Azure Key
// Vault with the user's own `az` login. Node only; the pure half is notify.mjs.

import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { NOTIFY_API_URL } from './notify.mjs';
import { SAFE_NAME } from './products.mjs';

/** @import { NotifyPreview, NotifyTemplate, Personalisation, TemplateType } from './notify.js' */
/** @import { ApiKey, ClientOptions, ExecFileLike, ReadSecretOptions } from './node.js' */

// API client

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A key is `<name>-<service id>-<secret>`, where both ids are UUIDs: the last 73 characters hold them.
 * @param {string} key
 * @returns {ApiKey}
 */
export function parseApiKey(key) {
    const trimmed = key.trim();
    const serviceId = trimmed.slice(-73, -37);
    const secret = trimmed.slice(-36);
    if (trimmed.length < 73 || trimmed[trimmed.length - 37] !== '-' || !UUID.test(serviceId) || !UUID.test(secret)) {
        throw new Error("The secret isn't a GOV.UK Notify API key: it should end with a service ID and a secret, both UUIDs.");
    }
    return { serviceId, secret };
}

/** @param {string | Buffer} input */
const base64url = (input) => Buffer.from(input).toString('base64url');

/**
 * An HS256 JWT with the service id as issuer, as Notify expects.
 * @param {ApiKey} key
 * @param {number} [nowMs]
 * @returns {string}
 */
export function signToken(key, nowMs = Date.now()) {
    const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'HS256' }));
    const claims = base64url(JSON.stringify({ iss: key.serviceId, iat: Math.floor(nowMs / 1000) }));
    const signature = base64url(createHmac('sha256', key.secret).update(`${header}.${claims}`).digest());
    return `${header}.${claims}.${signature}`;
}

export class NotifyApiError extends Error {
    /**
     * @param {string} message
     * @param {number} status the HTTP status
     * @param {{ error: string, message: string }[]} [errors] Notify's error list, when it sent one
     */
    constructor(message, status, errors = []) {
        super(message);
        this.name = 'NotifyApiError';
        this.status = status;
        this.errors = errors;
    }
}

/**
 * The URL without surrounding whitespace or trailing slashes, or undefined when nothing is left.
 * @param {string | undefined} url
 * @returns {string | undefined}
 */
const normaliseUrl = (url) => url?.trim().replace(/\/+$/, '') || undefined;

/** The read-only part of the Notify API: templates can be listed, read and previewed, but not changed. */
export class NotifyClient {
    #key;
    #baseUrl;
    #fetchImpl;

    /**
     * @param {string} apiKey
     * @param {ClientOptions} [options]
     */
    constructor(apiKey, options = {}) {
        this.#key = parseApiKey(apiKey);
        this.serviceId = this.#key.serviceId;
        this.#baseUrl = normaliseUrl(options.baseUrl) ?? NOTIFY_API_URL;
        this.#fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    }

    /**
     * @param {TemplateType} [type]
     * @returns {Promise<NotifyTemplate[]>}
     */
    async listTemplates(type) {
        const query = type ? `?${new URLSearchParams({ type })}` : '';
        const body = /** @type {{ templates?: NotifyTemplate[] }} */ (await this.#request('GET', `/v2/templates${query}`));
        return body.templates ?? [];
    }

    /**
     * @param {string} id
     * @returns {Promise<NotifyTemplate>}
     */
    getTemplate(id) {
        return /** @type {Promise<NotifyTemplate>} */ (this.#request('GET', `/v2/template/${encodeURIComponent(id)}`));
    }

    /**
     * @param {string} id
     * @param {Personalisation} personalisation
     * @param {AbortSignal} [signal]
     * @returns {Promise<NotifyPreview>}
     */
    previewTemplate(id, personalisation, signal) {
        return /** @type {Promise<NotifyPreview>} */ (this.#request('POST', `/v2/template/${encodeURIComponent(id)}/preview`, { personalisation }, signal));
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {unknown} [body]
     * @param {AbortSignal} [signal]
     * @returns {Promise<unknown>} the parsed JSON, unchecked: each caller asserts the shape Notify documents
     */
    async #request(method, path, body, signal) {
        const url = `${this.#baseUrl}${path}`;
        let response;
        try {
            response = await this.#fetchImpl(url, {
                method,
                headers: {
                    Authorization: `Bearer ${signToken(this.#key)}`,
                    Accept: 'application/json',
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal,
            });
        } catch (error) {
            if (signal?.aborted) throw error;
            const cause = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
            throw new Error(`Can't reach GOV.UK Notify at ${this.#baseUrl}: ${cause}`, { cause: error });
        }
        const text = await response.text();
        let parsed;
        try {
            parsed = text ? JSON.parse(text) : {};
        } catch {
            parsed = undefined;
        }
        if (!response.ok) throw apiError(response.status, parsed, text);
        if (parsed === undefined) throw new NotifyApiError(`GOV.UK Notify returned a response that isn't JSON from ${method} ${path}`, response.status);
        return parsed;
    }
}

/**
 * @param {number} status
 * @param {any} parsed
 * @param {string} text
 */
function apiError(status, parsed, text) {
    const raw = parsed?.errors;
    const errors = Array.isArray(raw)
        ? raw.filter((e) => typeof e === 'object' && e !== null).map((e) => ({ error: String(e.error ?? ''), message: String(e.message ?? '') }))
        : [];
    const detail = errors.length
        ? errors.map((e) => (e.error ? `${e.error}: ${e.message}` : e.message)).join('; ')
        : text.trim().slice(0, 200) || 'no details';
    return new NotifyApiError(`GOV.UK Notify returned ${status}: ${detail}`, status, errors);
}

// Key Vault

export class KeyVaultError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'KeyVaultError';
    }
}

const TIMEOUT_MS = 60_000;

/**
 * @param {string[]} args
 * @param {ExecFileLike} execFileImpl
 * @returns {Promise<string>}
 */
function run(args, execFileImpl) {
    // Windows installs az as az.cmd, which execFile can only start through cmd.exe. readSecret
    // only passes vault and secret names that match SAFE_NAME, so cmd.exe has nothing to expand.
    const [file, fileArgs] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'az', ...args]] : ['az', args];
    return new Promise((resolve, reject) => {
        execFileImpl(file, fileArgs, { timeout: TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
            if (error) reject(Object.assign(error, { stderr: String(stderr ?? '') }));
            else resolve(String(stdout));
        });
    });
}

/**
 * @param {Error & { code?: string | number | null, killed?: boolean, stderr?: string }} error
 * @param {string} vault
 * @param {string} secret
 */
function explain(error, vault, secret) {
    const stderr = error.stderr ?? '';
    if (error.code === 'ENOENT' || /is not recognized as an internal or external command/i.test(stderr)) {
        return new KeyVaultError("The Azure CLI (az) isn't installed or isn't on the PATH. Install it, then run `az login`.");
    }
    if (error.killed) return new KeyVaultError(`az took longer than ${TIMEOUT_MS / 1000}s to read ${secret} from ${vault}.`);
    if (/az login|AADSTS|refresh token|InteractionRequired|expired|not logged in/i.test(stderr)) {
        return new KeyVaultError('Your Azure CLI session has expired or you are not signed in: run `az login`, then try again.');
    }
    if (/Forbidden|does not have secrets get permission|AuthorizationFailed|\b403\b/i.test(stderr)) {
        return new KeyVaultError(`Forbidden: you have no read access to secrets in the Key Vault ${vault}.`);
    }
    if (/SecretNotFound/i.test(stderr)) return new KeyVaultError(`The Key Vault ${vault} has no secret named ${secret}.`);
    if (/getaddrinfo|ENOTFOUND|Failed to resolve|Name or service not known/i.test(stderr)) {
        return new KeyVaultError(`Couldn't reach the Key Vault ${vault}: check the name and your network.`);
    }
    const detail = stderr.split('\n').map((l) => l.trim()).find(Boolean) ?? error.message;
    return new KeyVaultError(`az couldn't read ${secret} from ${vault}: ${detail}`);
}

/**
 * Reads a secret with the user's own `az` login, without a shell.
 * @param {string} vault
 * @param {string} secret
 * @param {ReadSecretOptions} [options]
 * @returns {Promise<string>}
 */
export async function readSecret(vault, secret, { execFileImpl = /** @type {ExecFileLike} */ (execFile) } = {}) {
    if (!SAFE_NAME.test(vault) || !SAFE_NAME.test(secret)) {
        throw new KeyVaultError('Key Vault and secret names are letters, digits and hyphens, and start with a letter or digit.');
    }
    let stdout;
    try {
        stdout = await run(['keyvault', 'secret', 'show', '--vault-name', vault, '--name', secret, '--query', 'value', '-o', 'tsv'], execFileImpl);
    } catch (error) {
        throw explain(/** @type {Parameters<typeof explain>[0]} */ (error), vault, secret);
    }
    const value = stdout.trim();
    if (!value) throw new KeyVaultError(`The secret ${secret} in ${vault} is empty.`);
    return value;
}

/** Keeps keys read from Key Vault in memory for the session; nothing is written to disk. */
export class KeyStore {
    /** @type {Map<string, Promise<string>>} */
    #keys = new Map();
    #read;

    /** @param {(vault: string, secret: string) => Promise<string>} [read] */
    constructor(read = readSecret) {
        this.#read = read;
    }

    /**
     * @param {string} vault
     * @param {string} secret
     * @returns {Promise<string>}
     */
    get(vault, secret) {
        const id = `${vault}/${secret}`;
        let key = this.#keys.get(id);
        if (!key) {
            key = this.#read(vault, secret);
            this.#keys.set(id, key);
            key.catch(() => {
                if (this.#keys.get(id) === key) this.#keys.delete(id);
            });
        }
        return key;
    }

    /** @param {string} vault @param {string} secret */
    has(vault, secret) {
        return this.#keys.has(`${vault}/${secret}`);
    }

    forget() {
        this.#keys.clear();
    }
}
