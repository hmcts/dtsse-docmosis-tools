import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyApiError, NotifyClient, notifyApiUrl, parseApiKey, signToken, templateAdminUrl } from '../../src/notify/client';
import { KEY, SECRET, SERVICE } from './fixtures';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('parseApiKey', () => {
  it('takes the service id and secret from the last 73 characters', () => {
    expect(parseApiKey(KEY)).toEqual({ serviceId: SERVICE, secret: SECRET });
    expect(parseApiKey(`  key-with-dashes-in-its-name-${SERVICE}-${SECRET}\n`)).toEqual({ serviceId: SERVICE, secret: SECRET });
  });

  it('refuses anything else', () => {
    expect(() => parseApiKey('not-a-key')).toThrow(/isn't a GOV.UK Notify API key/);
    expect(() => parseApiKey(`${SERVICE}x${SECRET}`)).toThrow(/isn't a GOV.UK Notify API key/);
  });
});

describe('signToken', () => {
  it('signs an HS256 JWT with the service id as issuer and the time in seconds', () => {
    const token = signToken({ serviceId: SERVICE, secret: SECRET }, 1_700_000_000_999);
    const [header, claims, signature] = token.split('.');
    expect(decode(header!)).toEqual({ typ: 'JWT', alg: 'HS256' });
    expect(decode(claims!)).toEqual({ iss: SERVICE, iat: 1_700_000_000 });
    expect(signature).toBe(createHmac('sha256', SECRET).update(`${header}.${claims}`).digest('base64url'));
  });
});

describe('NotifyClient', () => {
  afterEach(() => {
    delete process.env.NOTIFY_API_URL;
  });

  it('lists templates with a bearer token', async () => {
    const { calls, impl } = fakeFetch(200, { templates: [{ id: 't1', name: 'A', type: 'email', version: 1, body: 'b' }] });
    const client = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: impl });
    expect(await client.listTemplates()).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://notify.test/v2/templates');
    expect(calls[0]!.init.method).toBe('GET');
    const auth = (calls[0]!.init.headers as Record<string, string>).Authorization!;
    expect(auth).toMatch(/^Bearer /);
    expect(decode(auth.slice(7).split('.')[1]!).iss).toBe(SERVICE);
  });

  it('reads one template and previews it with personalisation', async () => {
    const { calls, impl } = fakeFetch(200, { id: 't 1', type: 'sms', version: 2, body: 'Hi Ann' });
    const client = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: impl });
    await client.getTemplate('t 1');
    expect(calls[0]!.url).toBe('https://notify.test/v2/template/t%201');
    expect(await client.previewTemplate('t1', { name: 'Ann' })).toMatchObject({ body: 'Hi Ann' });
    expect(calls[1]!.url).toBe('https://notify.test/v2/template/t1/preview');
    expect(calls[1]!.init.method).toBe('POST');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ personalisation: { name: 'Ann' } });
  });

  it("surfaces Notify's error list", async () => {
    const { impl } = fakeFetch(400, {
      status_code: 400,
      errors: [{ error: 'BadRequestError', message: 'Missing personalisation: name' }],
    });
    const client = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: impl });
    const error = await client.previewTemplate('t1', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotifyApiError);
    expect(error).toMatchObject({
      status: 400,
      message: 'GOV.UK Notify returned 400: BadRequestError: Missing personalisation: name',
      errors: [{ error: 'BadRequestError', message: 'Missing personalisation: name' }],
    });
  });

  it('reports a reply that is not JSON, and a network failure', async () => {
    const html = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: fakeFetch(502, '<html>Bad gateway</html>').impl });
    await expect(html.listTemplates()).rejects.toThrow('GOV.UK Notify returned 502: <html>Bad gateway</html>');
    const down = new NotifyClient(KEY, {
      baseUrl: 'https://notify.test',
      fetchImpl: (() => Promise.reject(new TypeError('fetch failed', { cause: new Error('ENOTFOUND notify.test') }))) as typeof fetch,
    });
    await expect(down.listTemplates()).rejects.toThrow("Can't reach GOV.UK Notify at https://notify.test: ENOTFOUND notify.test");
  });

  it('uses NOTIFY_API_URL over the public API', async () => {
    expect(notifyApiUrl()).toBe('https://api.notifications.service.gov.uk');
    process.env.NOTIFY_API_URL = 'http://127.0.0.1:9999/';
    expect(notifyApiUrl()).toBe('http://127.0.0.1:9999');
    const fetchMock = vi.fn(async (_url: string) => new Response('{"templates":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    await new NotifyClient(KEY).listTemplates();
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:9999/v2/templates');
    vi.unstubAllGlobals();
  });

  it('links to the template in the Notify web app', () => {
    expect(templateAdminUrl(SERVICE, 't1')).toBe(`https://www.notifications.service.gov.uk/services/${SERVICE}/templates/t1`);
  });
});
