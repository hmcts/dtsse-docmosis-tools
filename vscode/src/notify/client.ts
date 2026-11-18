import { createHmac } from 'node:crypto';

export const NOTIFY_API_URL = 'https://api.notifications.service.gov.uk';
export const NOTIFY_ADMIN_URL = 'https://www.notifications.service.gov.uk';

export type TemplateType = 'email' | 'sms' | 'letter';

export interface NotifyTemplate {
  id: string;
  type: TemplateType;
  name: string;
  version: number;
  body: string;
  subject?: string | null;
  created_at?: string;
  updated_at?: string | null;
  created_by?: string;
  letter_contact_block?: string | null;
}

export interface NotifyPreview {
  id: string;
  type: TemplateType;
  version: number;
  body: string;
  subject?: string | null;
  html?: string | null;
}

export type Personalisation = Record<string, string | string[]>;

export interface ApiKey {
  serviceId: string;
  secret: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A key is `<name>-<service id>-<secret>`, where both ids are UUIDs: the last 73 characters hold them. */
export function parseApiKey(key: string): ApiKey {
  const trimmed = key.trim();
  const serviceId = trimmed.slice(-73, -37);
  const secret = trimmed.slice(-36);
  if (trimmed.length < 73 || trimmed[trimmed.length - 37] !== '-' || !UUID.test(serviceId) || !UUID.test(secret)) {
    throw new Error("The secret isn't a GOV.UK Notify API key: it should end with a service ID and a secret, both UUIDs.");
  }
  return { serviceId, secret };
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function signToken(key: ApiKey, nowMs = Date.now()): string {
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'HS256' }));
  const claims = base64url(JSON.stringify({ iss: key.serviceId, iat: Math.floor(nowMs / 1000) }));
  const signature = base64url(createHmac('sha256', key.secret).update(`${header}.${claims}`).digest());
  return `${header}.${claims}.${signature}`;
}

export class NotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: { error: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export const notifyApiUrl = (): string => (process.env.NOTIFY_API_URL || NOTIFY_API_URL).replace(/\/+$/, '');

export const templateAdminUrl = (serviceId: string, templateId: string): string =>
  `${NOTIFY_ADMIN_URL}/services/${serviceId}/templates/${templateId}`;

export interface ClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** The read-only part of the Notify API: templates can be listed, read and previewed, but not changed. */
export class NotifyClient {
  readonly serviceId: string;
  private readonly key: ApiKey;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, options: ClientOptions = {}) {
    this.key = parseApiKey(apiKey);
    this.serviceId = this.key.serviceId;
    this.baseUrl = options.baseUrl ?? notifyApiUrl();
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  async listTemplates(type?: TemplateType): Promise<NotifyTemplate[]> {
    const query = type ? `?type=${type}` : '';
    const body = await this.request<{ templates?: NotifyTemplate[] }>('GET', `/v2/templates${query}`);
    return body.templates ?? [];
  }

  getTemplate(id: string): Promise<NotifyTemplate> {
    return this.request<NotifyTemplate>('GET', `/v2/template/${encodeURIComponent(id)}`);
  }

  previewTemplate(id: string, personalisation: Personalisation, signal?: AbortSignal): Promise<NotifyPreview> {
    return this.request<NotifyPreview>('POST', `/v2/template/${encodeURIComponent(id)}/preview`, { personalisation }, signal);
  }

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${signToken(this.key)}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          'User-Agent': 'hmcts-template-preview',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const cause = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
      throw new Error(`Can't reach GOV.UK Notify at ${this.baseUrl}: ${cause}`, { cause: error });
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = undefined;
    }
    if (!response.ok) throw apiError(response.status, parsed, text);
    if (parsed === undefined) throw new NotifyApiError(`GOV.UK Notify returned a response that isn't JSON from ${method} ${path}`, response.status);
    return parsed as T;
  }
}

function apiError(status: number, parsed: unknown, text: string): NotifyApiError {
  const raw = (parsed as { errors?: unknown } | undefined)?.errors;
  const errors = Array.isArray(raw)
    ? raw
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((e) => ({ error: String(e.error ?? ''), message: String(e.message ?? '') }))
    : [];
  const detail = errors.length
    ? errors.map((e) => (e.error ? `${e.error}: ${e.message}` : e.message)).join('; ')
    : text.trim().slice(0, 200) || 'no details';
  return new NotifyApiError(`GOV.UK Notify returned ${status}: ${detail}`, status, errors);
}
