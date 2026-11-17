import { describe, expect, it } from 'vitest';
import { getAt, mergeData, setAt } from '../src/data';

describe('mergeData', () => {
  it('merges objects deeply and replaces arrays and scalars', () => {
    expect(mergeData({ a: { b: 1, c: 2 }, rows: [1, 2], s: 'x' }, { a: { b: 9 }, rows: [3], s: 'y' })).toEqual({
      a: { b: 9, c: 2 },
      rows: [3],
      s: 'y',
    });
  });

  it("doesn't mutate its inputs", () => {
    const base = { a: { b: 1 } };
    mergeData(base, { a: { b: 2 } });
    expect(base).toEqual({ a: { b: 1 } });
  });
});

describe('setAt', () => {
  it('sets nested values, creating objects and arrays on the way', () => {
    expect(setAt({}, ['a', 'b'], 'x')).toEqual({ a: { b: 'x' } });
    expect(setAt({}, ['rows', 1, 'name'], 'x')).toEqual({ rows: [{}, { name: 'x' }] });
  });

  it('removes a key and objects emptied by it', () => {
    expect(setAt({ a: { b: 'x' }, c: 1 }, ['a', 'b'], undefined)).toEqual({ c: 1 });
  });

  it('keeps array rows when a field in them is removed', () => {
    expect(setAt({ rows: [{ n: 'x' }] }, ['rows', 0, 'n'], undefined)).toEqual({ rows: [{}] });
  });

  it("doesn't mutate its input", () => {
    const data = { a: { b: 'x' } };
    setAt(data, ['a', 'b'], 'y');
    expect(data).toEqual({ a: { b: 'x' } });
  });

  it('can add an empty row to a missing array', () => {
    expect(setAt({}, ['rows', 0], {})).toEqual({ rows: [{}] });
  });
});

describe('getAt', () => {
  it('reads through objects and arrays', () => {
    expect(getAt({ rows: [{ n: 'x' }] }, ['rows', 0, 'n'])).toBe('x');
    expect(getAt({}, ['a', 'b'])).toBeUndefined();
  });
});
