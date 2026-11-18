import { describe, expect, it } from 'vitest';
import { coverage } from '../src/coverage';
import { inferSchema } from '../src/schema';
import { cond, field, rep } from './helpers';

const { root } = inferSchema([
  field('ref'),
  field('claimant.name'),
  cond('cs_isEngland', ['isEngland']),
  rep('defendants', [field('name'), field('age')]),
]);

describe('coverage', () => {
  it('reports template values the data lacks', () => {
    const c = coverage(root, { ref: 'A', claimant: {} });
    expect(c.missing).toEqual(['claimant.name', 'isEngland', 'defendants']);
  });

  it('treats empty strings as missing but false as supplied', () => {
    const c = coverage(root, { ref: '', isEngland: false, claimant: { name: 'x' }, defendants: [{ name: 'a', age: '3' }] });
    expect(c.missing).toEqual(['ref']);
  });

  it('reports data keys the template never reads, at the shallowest unknown path', () => {
    const c = coverage(root, { ref: 'A', extra: { deep: 1 }, claimant: { name: 'x', nickname: 'y' } });
    expect(c.unused).toEqual(['claimant.nickname', 'extra']);
  });

  it('reports repeat fields missing from every row, and unknown row keys', () => {
    const c = coverage(root, {
      ref: 'A', isEngland: true, claimant: { name: 'x' },
      defendants: [{ name: 'a', other: 1 }, { name: 'b' }],
    });
    expect(c.missing).toEqual(['defendants[].age']);
    expect(c.unused).toEqual(['defendants[].other']);
  });

  it("doesn't report repeat fields supplied by at least one row", () => {
    const c = coverage(root, { defendants: [{ name: 'a' }, { age: '1' }] });
    expect(c.missing).not.toContain('defendants[].age');
    expect(c.missing).not.toContain('defendants[].name');
  });

  it('has nothing to report for complete data', () => {
    const c = coverage(root, { ref: 'A', isEngland: true, claimant: { name: 'x' }, defendants: [{ name: 'a', age: '1' }] });
    expect(c).toEqual({ missing: [], unused: [] });
  });
});
