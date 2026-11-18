// lib/products.mjs: the built-in product table and the entries merged into it.
//
//   node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUILT_IN_PRODUCTS, mergeProducts } from '../lib/products.mjs';

describe('Notify products', () => {
    test('has unique ids, all in AAT vaults', () => {
        const ids = BUILT_IN_PRODUCTS.map((p) => p.id);
        assert.equal(new Set(ids).size, ids.length);
        for (const p of BUILT_IN_PRODUCTS) {
            assert.match(p.vault, /-aat$/, p.id);
            assert.match(p.secret, /^[A-Za-z0-9-]+$/, p.id);
        }
    });

    test('is frozen, entries included', () => {
        assert.ok(Object.isFrozen(BUILT_IN_PRODUCTS));
        for (const p of BUILT_IN_PRODUCTS) assert.ok(Object.isFrozen(p), p.id);
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
});
