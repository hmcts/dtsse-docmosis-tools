import { describe, expect, it } from 'vitest';
import * as library from '@hmcts-cft/docmosis-tools/schema';
import * as reexport from '../src/schema';
import { field } from './helpers';

describe('the schema module', () => {
  it('re-exports the library functions the extension uses, unchanged', () => {
    expect(reexport.inferSchema).toBe(library.inferSchema);
    expect(reexport.schemaPaths).toBe(library.schemaPaths);
    expect(reexport.summarise).toBe(library.summarise);
    expect(reexport.normaliseQuotes).toBe(library.normaliseQuotes);
  });

  it('infers from the extension tree shape', () => {
    const { root, warnings } = reexport.inferSchema([field('claimant.name')]);
    expect(reexport.schemaPaths(root)).toEqual([{ path: 'claimant.name', kind: 'string' }]);
    expect(warnings).toEqual([]);
  });
});
