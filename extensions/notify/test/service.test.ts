import { afterEach, describe, expect, it } from 'vitest';
import { configuredProducts } from '../src/service';
import { stub } from './vscodeStub';

const extra = { id: 'extra', label: 'Extra', vault: 'extra-aat', secret: 'key' };

describe('Notify products', () => {
  afterEach(() => {
    stub.settings = {};
  });

  it('reads hmctsNotify.products', () => {
    stub.settings = { 'hmctsNotify.products': [extra] };
    expect(configuredProducts().some((p) => p.id === 'extra')).toBe(true);
  });

  it('falls back to hmctsTemplatePreview.notify.products while the new setting is unset', () => {
    stub.settings = { 'hmctsTemplatePreview.notify.products': [extra] };
    expect(configuredProducts().some((p) => p.id === 'extra')).toBe(true);
  });

  it('ignores the old setting once the new one is set', () => {
    stub.settings = { 'hmctsNotify.products': [], 'hmctsTemplatePreview.notify.products': [extra] };
    expect(configuredProducts().some((p) => p.id === 'extra')).toBe(false);
  });
});
