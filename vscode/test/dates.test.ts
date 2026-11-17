import { describe, expect, it } from 'vitest';
import { matchesDateFormat, formatDate, inputToStored, isDateOnlyFormat, parseDate, storedToInput } from '../src/dates';

describe('dates', () => {
  it('recognises date-only formats', () => {
    expect(isDateOnlyFormat('yyyy-MM-dd')).toBe(true);
    expect(isDateOnlyFormat('dd/MM/yyyy')).toBe(true);
    expect(isDateOnlyFormat('yyyy-MM-dd HH:mm')).toBe(false);
    expect(isDateOnlyFormat('d MMMM yyyy')).toBe(false);
  });

  it('parses and formats', () => {
    expect(parseDate('2026-03-09', 'yyyy-MM-dd')).toEqual({ year: 2026, month: 3, day: 9 });
    expect(parseDate('9/3/2026', 'd/M/yyyy')).toEqual({ year: 2026, month: 3, day: 9 });
    expect(formatDate({ year: 2026, month: 3, day: 9 }, 'dd/MM/yyyy')).toBe('09/03/2026');
  });

  it('rejects impossible dates and mismatches', () => {
    expect(parseDate('2026-02-30', 'yyyy-MM-dd')).toBeUndefined();
    expect(parseDate('09/03/2026', 'yyyy-MM-dd')).toBeUndefined();
  });

  it('converts between the stored value and the date input', () => {
    expect(storedToInput('09/03/2026', 'dd/MM/yyyy')).toBe('2026-03-09');
    expect(inputToStored('2026-03-09', 'dd/MM/yyyy')).toBe('09/03/2026');
    expect(inputToStored('', 'dd/MM/yyyy')).toBe('');
    expect(storedToInput('nonsense', 'dd/MM/yyyy')).toBe('');
  });

  it('checks the shape of a value against a date format', () => {
    expect(matchesDateFormat('01-02-2020', 'dd-MM-yyyy')).toBe(true);
    expect(matchesDateFormat('1-2-2020', 'dd-MM-yyyy')).toBe(true);
    expect(matchesDateFormat('2020-02-01', 'yyyy-MM-dd')).toBe(true);
    expect(matchesDateFormat('1 March 2020', 'd MMMM yyyy')).toBe(true);
    expect(matchesDateFormat('1 Mar 20', 'd MMM yy')).toBe(true);
    expect(matchesDateFormat('01/02/20', 'dd/MM/yy')).toBe(true);
    expect(matchesDateFormat('234', 'dd-MM-yyyy')).toBe(false);
    expect(matchesDateFormat('01/02/2020', 'dd-MM-yyyy')).toBe(false);
    expect(matchesDateFormat('first of May', 'yyyy-MM-dd')).toBe(false);
    expect(matchesDateFormat('2020-02-01', 'dd MMMM yyyy')).toBe(false);
  });

  it('leaves formats with time tokens or quoted text unchecked', () => {
    expect(matchesDateFormat('anything', 'yyyy-MM-dd HH:mm')).toBeUndefined();
    expect(matchesDateFormat('anything', "dd 'of' MMMM yyyy")).toBeUndefined();
    expect(matchesDateFormat('anything', 'yyyy')).toBeUndefined();
    expect(matchesDateFormat('anything', "yyyy-MM-dd'T'HH:mm:ss")).toBeUndefined();
  });
});
