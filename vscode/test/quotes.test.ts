import { describe, expect, it } from 'vitest';
import { inferSchema, normaliseQuotes } from '../src/schema';
import { field } from './helpers';

describe('quote styles in dateFormat', () => {
  it('reads curly single quotes, as Word inserts them', () => {
    const { root } = inferSchema([field('{dateFormat(issueDate,‘d MMMM yyyy’,‘dd-MM-yyyy’)}', ['issueDate'])]);
    expect(root.properties.issueDate).toMatchObject({ kind: 'date', inputFormat: 'dd-MM-yyyy' });
  });

  it('reads curly double quotes, straight quotes and a mixture', () => {
    const { root } = inferSchema([
      field('{dateFormat(a,“d MMMM yyyy”,“dd/MM/yyyy”)}', ['a']),
      field('{dateFormat(b,"d MMMM yyyy","yyyy-MM-dd")}', ['b']),
      field('{dateFormat(c,‘d MMMM yyyy\',"MM-dd-yyyy")}', ['c']),
    ]);
    expect(root.properties.a).toMatchObject({ kind: 'date', inputFormat: 'dd/MM/yyyy' });
    expect(root.properties.b).toMatchObject({ kind: 'date', inputFormat: 'yyyy-MM-dd' });
    expect(root.properties.c).toMatchObject({ kind: 'date', inputFormat: 'MM-dd-yyyy' });
  });

  it('normalises every quote style to a straight one', () => {
    expect(normaliseQuotes('‘a’ “b” \'c\' "d"')).toBe('\'a\' "b" \'c\' "d"');
  });
});
