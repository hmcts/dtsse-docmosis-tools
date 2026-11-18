import { afterEach, describe, expect, it } from 'vitest';
import { BUILT_IN_PRODUCTS, configuredProducts, mergeProducts } from '../../src/notify/products';
import { stub } from '../vscodeStub';

describe('Notify products', () => {
  afterEach(() => {
    stub.settings = {};
  });

  it('has unique ids, all in AAT vaults', () => {
    const ids = BUILT_IN_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BUILT_IN_PRODUCTS) {
      expect(p.vault, p.id).toMatch(/-aat$/);
      expect(p.secret, p.id).toMatch(/^[A-Za-z0-9-]+$/);
    }
  });

  it('lets the setting replace a built-in entry and add new ones, sorted by label', () => {
    const merged = mergeProducts([
      { id: 'sptribs', label: 'SPTribs (test key)', vault: 'sptribs-aat', secret: 'notify-test-key' },
      { id: 'amp', vault: 'amp-aat', secret: 'notify-key' },
    ]);
    expect(merged).toHaveLength(BUILT_IN_PRODUCTS.length + 1);
    expect(merged.find((p) => p.id === 'sptribs')).toEqual({ id: 'sptribs', label: 'SPTribs (test key)', vault: 'sptribs-aat', secret: 'notify-test-key' });
    expect(merged.find((p) => p.id === 'amp')).toEqual({ id: 'amp', label: 'amp', vault: 'amp-aat', secret: 'notify-key' });
    expect(merged.map((p) => p.label)).toEqual([...merged.map((p) => p.label)].sort((a, b) => a.localeCompare(b)));
  });

  it('drops setting entries it cannot use', () => {
    const merged = mergeProducts([{ id: 'x' }, 'nonsense', { id: '../up', vault: 'v', secret: 's' }, { id: 'y', vault: 'v; rm -rf', secret: 's' }]);
    expect(merged).toHaveLength(BUILT_IN_PRODUCTS.length);
    expect(mergeProducts('not an array')).toHaveLength(BUILT_IN_PRODUCTS.length);
  });

  it('reads hmctsTemplatePreview.notify.products', () => {
    stub.settings = { 'notify.products': [{ id: 'extra', label: 'Extra', vault: 'extra-aat', secret: 'key' }] };
    expect(configuredProducts().some((p) => p.id === 'extra')).toBe(true);
  });
});
