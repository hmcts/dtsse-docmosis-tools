import { afterEach, describe, expect, it } from 'vitest';
import { configuredProducts } from '../../src/notify/service';
import { stub } from '../vscodeStub';

describe('Notify products', () => {
  afterEach(() => {
    stub.settings = {};
  });

  it('reads hmctsTemplatePreview.notify.products', () => {
    stub.settings = { 'notify.products': [{ id: 'extra', label: 'Extra', vault: 'extra-aat', secret: 'key' }] };
    expect(configuredProducts().some((p) => p.id === 'extra')).toBe(true);
  });
});
