// lib/notify.mjs: the product table, placeholders and the local preview.
//
//   node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    apiPersonalisation,
    BUILT_IN_PRODUCTS,
    dataKey,
    fill,
    findPlaceholders,
    formValues,
    isYes,
    lookup,
    mergeProducts,
    notifyMarkdown,
    personalisationSchema,
    placeholderKey,
    renderLocal,
    smsCount,
    templateAdminUrl,
} from '../lib/notify.mjs';
import * as notify from '../lib/notify.mjs';

const SERVICE = '26785a09-ab16-4eb0-8407-a37497a57506';

describe('Notify products', () => {
    test('has unique ids, all in AAT vaults', () => {
        const ids = BUILT_IN_PRODUCTS.map((p) => p.id);
        assert.equal(new Set(ids).size, ids.length);
        for (const p of BUILT_IN_PRODUCTS) {
            assert.match(p.vault, /-aat$/, p.id);
            assert.match(p.secret, /^[A-Za-z0-9-]+$/, p.id);
        }
    });

    test('lets the entries replace a built-in entry and add new ones, sorted by label', () => {
        const merged = mergeProducts([
            { id: 'sptribs', label: 'SPTribs (test key)', vault: 'sptribs-aat', secret: 'notify-test-key' },
            { id: 'amp', vault: 'amp-aat', secret: 'notify-key' },
        ]);
        assert.equal(merged.length, BUILT_IN_PRODUCTS.length + 1);
        assert.deepEqual(merged.find((p) => p.id === 'sptribs'), { id: 'sptribs', label: 'SPTribs (test key)', vault: 'sptribs-aat', secret: 'notify-test-key' });
        assert.deepEqual(merged.find((p) => p.id === 'amp'), { id: 'amp', label: 'amp', vault: 'amp-aat', secret: 'notify-key' });
        assert.deepEqual(merged.map((p) => p.label), [...merged.map((p) => p.label)].sort((a, b) => a.localeCompare(b)));
    });

    test('drops entries it cannot use', () => {
        const merged = mergeProducts([{ id: 'x' }, 'nonsense', { id: '../up', vault: 'v', secret: 's' }, { id: 'y', vault: 'v; rm -rf', secret: 's' }]);
        assert.equal(merged.length, BUILT_IN_PRODUCTS.length);
        assert.equal(mergeProducts('not an array').length, BUILT_IN_PRODUCTS.length);
    });

    test('links to the template in the Notify web app', () => {
        assert.equal(templateAdminUrl(SERVICE, 't1'), `https://www.notifications.service.gov.uk/services/${SERVICE}/templates/t1`);
    });
});

describe('findPlaceholders', () => {
    test('finds plain and conditional placeholders in the subject and body, in order', () => {
        const found = findPlaceholders('Your case ((case number))', 'Dear ((name)),\n((has_hearing??Your hearing is listed.))\n((date))');
        assert.deepEqual(
            found.map((p) => [p.name, p.conditional]),
            [
                ['case number', false],
                ['name', false],
                ['has_hearing', true],
                ['date', false],
            ],
        );
    });

    test('matches names as Notify does, ignoring case, spaces, underscores and hyphens', () => {
        assert.equal(placeholderKey(' First_Name '), 'firstname');
        const found = findPlaceholders('((First name)) ((first_name)) ((FIRST-NAME))');
        assert.equal(found.length, 1);
        assert.equal(found[0].name, 'First name');
    });

    test('treats a name used both ways as text', () => {
        const [p] = findPlaceholders('((urgent??URGENT: )) ((urgent))');
        assert.equal(p.name, 'urgent');
        assert.equal(p.conditional, false);
        assert.deepEqual(p.shows, ['URGENT: ']);
    });

    test('ignores empty and unclosed placeholders', () => {
        assert.deepEqual(findPlaceholders('(( )) ((name) (name))'), []);
    });
});

describe('personalisationSchema', () => {
    test('builds text inputs and checkboxes for a form', () => {
        assert.deepEqual(personalisationSchema(findPlaceholders('((name)) ((welsh??Cymraeg))')), {
            kind: 'object',
            controls: [],
            notes: [],
            properties: {
                name: { kind: 'string', controls: [], notes: [] },
                welsh: { kind: 'boolean', controls: [], notes: ['Shows: "Cymraeg"'] },
            },
        });
    });
});

describe('apiPersonalisation', () => {
    test('sends values, yes or no for conditionals, and ((name)) for anything missing', () => {
        const placeholders = findPlaceholders('((name)) ((date)) ((items)) ((welsh??x)) ((urgent??y))');
        assert.deepEqual(apiPersonalisation(placeholders, { Name: 'Ann', items: ['a', 'b'], welsh: true }), {
            personalisation: { name: 'Ann', date: '((date))', items: ['a', 'b'], welsh: 'yes', urgent: 'no' },
            missing: ['date'],
        });
    });
});

describe('lookup and isYes', () => {
    test('looks values up by Notify name', () => {
        assert.equal(lookup({ first_name: 'Ann' }, 'First Name'), 'Ann');
        assert.equal(lookup({}, 'x'), undefined);
    });

    test('counts true, yes, y and 1 as yes', () => {
        assert.equal([true, 'yes', 'Y', 'true', '1'].every(isYes), true);
        assert.equal([false, 'no', '', undefined, 'maybe'].some(isYes), false);
    });
});

describe('the personalisation form', () => {
    const placeholders = findPlaceholders('Dear ((First name)), case ((case_ref)). ((remote??By video.)) ((items))');

    test('shows saved data the way the previews read it', () => {
        assert.deepEqual(formValues(placeholders, { first_name: 'Ann', 'CASE-REF': 123, Remote: 'yes', items: ['a', 'b'] }), {
            'First name': 'Ann',
            case_ref: '123',
            remote: true,
            items: '["a","b"]',
        });
        assert.deepEqual(formValues(placeholders, { remote: 'no' }), { remote: false });
    });

    test('edits the key the data already has for a placeholder', () => {
        assert.equal(dataKey({ first_name: 'Ann' }, 'First name'), 'first_name');
        assert.equal(dataKey({ 'First name': 'Ann', first_name: 'Bob' }, 'First name'), 'First name');
        assert.equal(dataKey({}, 'First name'), 'First name');
        assert.equal(lookup({}, 'constructor'), undefined);
    });
});

describe('notifyMarkdown', () => {
    test('formats headings, paragraphs and line breaks', () => {
        assert.equal(notifyMarkdown('# Your claim\n\nLine one\nline two\n\n## Next'), '<h2>Your claim</h2>\n<p>Line one<br>line two</p>\n<h3>Next</h3>');
    });

    test('formats bullets and numbered lists', () => {
        assert.equal(
            notifyMarkdown('Bring:\n* a\n- b\n• c\n\n1. first\n2. second'),
            '<p>Bring:</p>\n<ul><li>a</li><li>b</li><li>c</li></ul>\n<ol><li>first</li><li>second</li></ol>',
        );
    });

    test('formats inset text and horizontal rules', () => {
        assert.equal(notifyMarkdown('^ Important\nstill inset\n\n---\nafter'), '<blockquote class="inset">Important<br>still inset</blockquote>\n<hr>\n<p>after</p>');
    });

    test('links markdown links and bare URLs, and escapes HTML', () => {
        assert.equal(
            notifyMarkdown('[Sign in](https://example.gov.uk/a?b=1&c=2) or https://gov.uk. <script>'),
            '<p><a href="https://example.gov.uk/a?b=1&amp;c=2">Sign in</a> or <a href="https://gov.uk">https://gov.uk</a>. &lt;script&gt;</p>',
        );
    });

    test('links URLs in quotes without the quotes', () => {
        assert.equal(notifyMarkdown('Go to "https://x.com" now'), '<p>Go to &quot;<a href="https://x.com">https://x.com</a>&quot; now</p>');
    });

    test('keeps placeholders in URLs and link text inside one link', () => {
        assert.equal(
            notifyMarkdown('See https://x.com/cases/((case id)).'),
            '<p>See <a href="https://x.com/cases/((case id))">https://x.com/cases/<span class="placeholder">((case id))</span></a>.</p>',
        );
        assert.equal(
            notifyMarkdown('[View ((case id))](https://x.com/((case id))?a=1&b=2)'),
            '<p><a href="https://x.com/((case id))?a=1&amp;b=2">View <span class="placeholder">((case id))</span></a></p>',
        );
    });

    test('escapes link text and a placeholder that looks like markup', () => {
        assert.equal(notifyMarkdown('[<b>](https://x.com) ((<i>))'), '<p><a href="https://x.com">&lt;b&gt;</a> <span class="placeholder">((&lt;i&gt;))</span></p>');
    });

    test('marks placeholders left unfilled', () => {
        assert.equal(notifyMarkdown('Dear ((name))'), '<p>Dear <span class="placeholder">((name))</span></p>');
    });
});

describe('fill', () => {
    test('fills values, applies conditionals and keeps missing placeholders', () => {
        const text = 'Dear ((Name)), ((welsh??Croeso. ))((english??Welcome. ))((missing))';
        assert.equal(fill(text, { name: 'Ann', welsh: true, english: 'no' }, 'inline'), 'Dear Ann, Croeso. ((missing))');
    });

    test('turns lists into bullets where formatted and a sentence elsewhere', () => {
        assert.equal(fill('You need: ((items))', { items: ['a', 'b', 'c'] }, 'bullets'), 'You need: \n\n* a\n* b\n* c\n\n');
        assert.equal(fill('You need: ((items))', { items: ['a', 'b', 'c'] }, 'inline'), 'You need: a, b and c');
        assert.equal(fill('((items))', { items: ['a'] }, 'inline'), 'a');
    });
});

describe('smsCount', () => {
    test('counts GSM messages at 160, then 153 per part', () => {
        assert.deepEqual(smsCount('a'.repeat(160)), { characters: 160, fragments: 1, unicode: false });
        assert.deepEqual(smsCount('a'.repeat(161)), { characters: 161, fragments: 2, unicode: false });
        assert.deepEqual(smsCount('a'.repeat(307)), { characters: 307, fragments: 3, unicode: false });
    });

    test('counts extended characters twice', () => {
        assert.deepEqual(smsCount('€[]'), { characters: 6, fragments: 1, unicode: false });
    });

    test('counts Unicode messages at 70, then 67 per part', () => {
        assert.deepEqual(smsCount('ŵ'.repeat(70)), { characters: 70, fragments: 1, unicode: true });
        assert.deepEqual(smsCount('ŵ'.repeat(71)), { characters: 71, fragments: 2, unicode: true });
    });

    test('counts Unicode messages by code point, as Notify does', () => {
        assert.deepEqual(smsCount('😀'.repeat(70)), { characters: 70, fragments: 1, unicode: true });
    });

    test('counts the characters Notify swaps for GSM ones as GSM', () => {
        assert.deepEqual(smsCount('It’s “done” – see…'), { characters: 20, fragments: 1, unicode: false });
        assert.deepEqual(smsCount('a\u00a0b\tc\u200bd'), { characters: 6, fragments: 1, unicode: false });
        assert.deepEqual(smsCount('‘'.repeat(161)), { characters: 161, fragments: 2, unicode: false });
        assert.deepEqual(smsCount('a\u2011b\u2212c\u201ad\u201ee\u202ff\u2028g'), { characters: 12, fragments: 1, unicode: false });
    });

    test('counts a zero width joiner as Unicode, as Notify does for text messages', () => {
        assert.equal(smsCount('a\u200db').unicode, true);
    });

    test('counts an empty message as none', () => {
        assert.equal(smsCount('').fragments, 0);
    });
});

describe('renderLocal', () => {
    test('renders an email subject and HTML body', () => {
        assert.deepEqual(renderLocal('email', 'Case ((ref))', '# Hi ((name))\n\n((items))', { ref: '123', name: 'Ann', items: ['a', 'b'] }), {
            subject: 'Case 123',
            html: '<h2>Hi Ann</h2>\n<ul><li>a</li><li>b</li></ul>',
        });
    });

    test('renders a text message as plain text with its count', () => {
        assert.deepEqual(renderLocal('sms', null, 'Hi ((name)) # not a heading ', { name: 'Ann' }), {
            text: 'Hi Ann # not a heading',
            sms: { characters: 22, fragments: 1, unicode: false },
        });
    });
});

describe('exports', () => {
    test("doesn't share the stateful placeholder regex", () => {
        assert.equal('PLACEHOLDER' in notify, false);
    });
});
