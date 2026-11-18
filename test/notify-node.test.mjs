// lib/notify-node.mjs against an injected fetch and execFile; no network and no az.
//
//   node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { KeyStore, KeyVaultError, NotifyApiError, NotifyClient, notifyApiOverride, notifyApiUrl, parseApiKey, readSecret, signToken } from '../lib/notify-node.mjs';

const SERVICE = '26785a09-ab16-4eb0-8407-a37497a57506';
const SECRET = '3d844edf-8d35-48ac-975b-e847b4f122b0';
// A key in Notify's format, made up for tests.
const KEY = `my_test_key-${SERVICE}-${SECRET}`;

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

function fakeFetch(status, body) {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url, init });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };
    return { calls, impl };
}

describe('parseApiKey', () => {
    test('takes the service id and secret from the last 73 characters', () => {
        assert.deepEqual(parseApiKey(KEY), { serviceId: SERVICE, secret: SECRET });
        assert.deepEqual(parseApiKey(`  key-with-dashes-in-its-name-${SERVICE}-${SECRET}\n`), { serviceId: SERVICE, secret: SECRET });
    });

    test('refuses anything else', () => {
        assert.throws(() => parseApiKey('not-a-key'), /isn't a GOV.UK Notify API key/);
        assert.throws(() => parseApiKey(`${SERVICE}x${SECRET}`), /isn't a GOV.UK Notify API key/);
    });
});

describe('signToken', () => {
    test('signs an HS256 JWT with the service id as issuer and the time in seconds', () => {
        const token = signToken({ serviceId: SERVICE, secret: SECRET }, 1_700_000_000_999);
        const [header, claims, signature] = token.split('.');
        assert.deepEqual(decode(header), { typ: 'JWT', alg: 'HS256' });
        assert.deepEqual(decode(claims), { iss: SERVICE, iat: 1_700_000_000 });
        assert.equal(signature, createHmac('sha256', SECRET).update(`${header}.${claims}`).digest('base64url'));
    });
});

describe('NotifyClient', () => {
    const saved = { HMCTS_TEMPLATE_PREVIEW_NOTIFY_URL: process.env.HMCTS_TEMPLATE_PREVIEW_NOTIFY_URL, NOTIFY_API_URL: process.env.NOTIFY_API_URL };

    beforeEach(() => {
        delete process.env.HMCTS_TEMPLATE_PREVIEW_NOTIFY_URL;
        delete process.env.NOTIFY_API_URL;
    });

    afterEach(() => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        mock.restoreAll();
    });

    test('lists templates with a bearer token', async () => {
        const { calls, impl } = fakeFetch(200, { templates: [{ id: 't1', name: 'A', type: 'email', version: 1, body: 'b' }] });
        const client = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: impl });
        assert.equal((await client.listTemplates()).length, 1);
        assert.equal(calls[0].url, 'https://notify.test/v2/templates');
        assert.equal(calls[0].init.method, 'GET');
        const auth = calls[0].init.headers.Authorization;
        assert.match(auth, /^Bearer /);
        assert.equal(decode(auth.slice(7).split('.')[1]).iss, SERVICE);
    });

    test('asks for one type of template, encoded', async () => {
        const { calls, impl } = fakeFetch(200, { templates: [] });
        const client = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: impl });
        await client.listTemplates('sms');
        await client.listTemplates('a&b=c');
        assert.equal(calls[0].url, 'https://notify.test/v2/templates?type=sms');
        assert.equal(calls[1].url, 'https://notify.test/v2/templates?type=a%26b%3Dc');
    });

    test('drops surrounding whitespace and trailing slashes from baseUrl', async () => {
        for (const baseUrl of ['https://notify.test//', 'https://notify.test/ ', ' https://notify.test\n']) {
            const { calls, impl } = fakeFetch(200, { templates: [] });
            await new NotifyClient(KEY, { baseUrl, fetchImpl: impl }).listTemplates();
            assert.equal(calls[0].url, 'https://notify.test/v2/templates', `baseUrl ${JSON.stringify(baseUrl)}`);
        }
    });

    test('uses the public API when baseUrl is empty, blank or only slashes', async () => {
        for (const baseUrl of ['', ' ', '/', ' / ']) {
            const { calls, impl } = fakeFetch(200, { templates: [] });
            await new NotifyClient(KEY, { baseUrl, fetchImpl: impl }).listTemplates();
            assert.equal(calls[0].url, 'https://api.notifications.service.gov.uk/v2/templates', `baseUrl ${JSON.stringify(baseUrl)}`);
        }
    });

    test('reads one template and previews it with personalisation', async () => {
        const { calls, impl } = fakeFetch(200, { id: 't 1', type: 'sms', version: 2, body: 'Hi Ann' });
        const client = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: impl });
        await client.getTemplate('t 1');
        assert.equal(calls[0].url, 'https://notify.test/v2/template/t%201');
        assert.equal((await client.previewTemplate('t1', { name: 'Ann' })).body, 'Hi Ann');
        assert.equal(calls[1].url, 'https://notify.test/v2/template/t1/preview');
        assert.equal(calls[1].init.method, 'POST');
        assert.deepEqual(JSON.parse(calls[1].init.body), { personalisation: { name: 'Ann' } });
    });

    test("surfaces Notify's error list", async () => {
        const { impl } = fakeFetch(400, {
            status_code: 400,
            errors: [{ error: 'BadRequestError', message: 'Missing personalisation: name' }],
        });
        const client = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: impl });
        const error = await client.previewTemplate('t1', {}).catch((e) => e);
        assert.ok(error instanceof NotifyApiError);
        assert.equal(error.status, 400);
        assert.equal(error.message, 'GOV.UK Notify returned 400: BadRequestError: Missing personalisation: name');
        assert.deepEqual(error.errors, [{ error: 'BadRequestError', message: 'Missing personalisation: name' }]);
    });

    test('reports a reply that is not JSON, and a network failure', async () => {
        const html = new NotifyClient(KEY, { baseUrl: 'https://notify.test', fetchImpl: fakeFetch(502, '<html>Bad gateway</html>').impl });
        await assert.rejects(html.listTemplates(), { message: 'GOV.UK Notify returned 502: <html>Bad gateway</html>' });
        const down = new NotifyClient(KEY, {
            baseUrl: 'https://notify.test',
            fetchImpl: () => Promise.reject(new TypeError('fetch failed', { cause: new Error('ENOTFOUND notify.test') })),
        });
        await assert.rejects(down.listTemplates(), { message: "Can't reach GOV.UK Notify at https://notify.test: ENOTFOUND notify.test" });
    });

    test('uses HMCTS_TEMPLATE_PREVIEW_NOTIFY_URL over the public API', async () => {
        process.env.NOTIFY_API_URL = 'http://127.0.0.1:1/';
        assert.equal(notifyApiUrl(), 'https://api.notifications.service.gov.uk');
        assert.equal(notifyApiOverride(), undefined);
        delete process.env.NOTIFY_API_URL;
        process.env.HMCTS_TEMPLATE_PREVIEW_NOTIFY_URL = 'http://127.0.0.1:9999/';
        assert.equal(notifyApiUrl(), 'http://127.0.0.1:9999');
        assert.equal(notifyApiOverride(), 'http://127.0.0.1:9999');
        const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{"templates":[]}'));
        await new NotifyClient(KEY).listTemplates();
        assert.equal(fetchMock.mock.calls[0].arguments[0], 'http://127.0.0.1:9999/v2/templates');
    });
});

describe('readSecret', () => {
    let calls;
    let reply;
    // Answers each az call through its callback, as execFile does.
    const execFileImpl = (...args) => {
        calls.push(args);
        reply(args[3]);
    };
    const answer = (stdout) => (reply = (callback) => callback(null, stdout, ''));
    const fail = (stderr, extra = {}) => (reply = (callback) => callback(Object.assign(new Error('Command failed'), { code: 1, ...extra }), '', stderr));

    beforeEach(() => {
        calls = [];
    });

    test('runs az without a shell and returns the trimmed value', async () => {
        answer('the-key\n');
        assert.equal(await readSecret('sptribs-aat', 'uk-gov-notify-api-key', { execFileImpl }), 'the-key');
        const [file, args, options] = calls[0];
        if (process.platform === 'win32') {
            assert.equal(file, 'cmd.exe');
        } else {
            assert.equal(file, 'az');
            assert.deepEqual(args, ['keyvault', 'secret', 'show', '--vault-name', 'sptribs-aat', '--name', 'uk-gov-notify-api-key', '--query', 'value', '-o', 'tsv']);
        }
        assert.equal(Object.hasOwn(options, 'shell'), false);
    });

    for (const [name, stderr, extra, expected] of [
        ['az is missing', '', { code: 'ENOENT' }, "The Azure CLI (az) isn't installed or isn't on the PATH. Install it, then run `az login`."],
        ['not signed in', "ERROR: Please run 'az login' to setup account.", {}, 'Your Azure CLI session has expired or you are not signed in: run `az login`, then try again.'],
        [
            'the login expired',
            'ERROR: AADSTS700082: The refresh token has expired due to inactivity.',
            {},
            'Your Azure CLI session has expired or you are not signed in: run `az login`, then try again.',
        ],
        [
            'no access',
            "ERROR: (Forbidden) The user, group or application does not have secrets get permission on key vault 'amp-aat'.",
            {},
            'Forbidden: you have no read access to secrets in the Key Vault amp-aat.',
        ],
        ['no such secret', 'ERROR: (SecretNotFound) A secret with (name/id) x was not found in this key vault.', {}, 'The Key Vault amp-aat has no secret named x.'],
        ['anything else', 'ERROR: something odd\nmore', {}, "az couldn't read x from amp-aat: ERROR: something odd"],
    ]) {
        test(`explains ${name}`, async () => {
            fail(stderr, extra);
            const error = await readSecret('amp-aat', 'x', { execFileImpl }).catch((e) => e);
            assert.ok(error instanceof KeyVaultError);
            assert.equal(error.message, expected);
        });
    }

    test('refuses an empty secret', async () => {
        answer('\n');
        await assert.rejects(readSecret('v', 's', { execFileImpl }), { message: 'The secret s in v is empty.' });
    });

    test('refuses names that are not letters, digits and hyphens, without running az', async () => {
        answer('the-key');
        for (const [vault, secret] of [
            ['v & calc', 's'],
            ['v', 's|x'],
            ['-v', 's'],
            ['', 's'],
        ]) {
            await assert.rejects(readSecret(vault, secret, { execFileImpl }), KeyVaultError);
        }
        assert.equal(calls.length, 0);
    });
});

describe('KeyStore', () => {
    test('reads each key once until it is forgotten', async () => {
        const read = mock.fn(async (vault, secret) => `${vault}:${secret}`);
        const keys = new KeyStore(read);
        assert.equal(await keys.get('v', 's'), 'v:s');
        assert.equal(await keys.get('v', 's'), 'v:s');
        assert.equal(read.mock.callCount(), 1);
        assert.equal(keys.has('v', 's'), true);
        keys.forget();
        assert.equal(keys.has('v', 's'), false);
        await keys.get('v', 's');
        assert.equal(read.mock.callCount(), 2);
    });

    test("doesn't keep a failed read", async () => {
        const results = [Promise.reject(new KeyVaultError('no')), Promise.resolve('key')];
        results[0].catch(() => {});
        const keys = new KeyStore(async () => results.shift());
        await assert.rejects(keys.get('v', 's'), { message: 'no' });
        assert.equal(await keys.get('v', 's'), 'key');
    });
});
