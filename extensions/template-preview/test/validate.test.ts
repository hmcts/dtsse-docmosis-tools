import { describe, expect, it } from 'vitest';
import { inferSchema } from '../src/schema';
import { pathKey, renderBlockers, schemaPathOf, validateData, validateValue } from '../src/validate';
import { field, rep } from './helpers';

const spc = field('{dateFormat(issueDate,‘d MMMM yyyy’,‘dd-MM-yyyy’)}', ['issueDate']);
const { root } = inferSchema([
  spc,
  field("{dateFormat(sealed,'d MMMM yyyy','yyyy-MM-dd HH:mm')}", ['sealed']),
  field('name'),
  field("{dateFormat(served,'d MMMM yyyy')}", ['served']),
  rep('items', [field("{dateFormat(due,'d MMMM yyyy','yyyy-MM-dd')}", ['due'])]),
]);

describe('validateData', () => {
  it('flags a date that does not match the input format of the curly-quoted template', () => {
    expect(validateData(root, { issueDate: '234' })).toEqual([
      { path: ['issueDate'], message: '"234" isn\'t a date written as dd-MM-yyyy.' },
    ]);
  });

  it('accepts a matching date, and a missing or empty one, which render blank', () => {
    expect(validateData(root, { issueDate: '01-02-2020' })).toEqual([]);
    expect(validateData(root, {})).toEqual([]);
    expect(validateData(root, { issueDate: '' })).toEqual([]);
  });

  it('flags a non-string date', () => {
    expect(validateData(root, { issueDate: 5 })[0]?.message).toMatch(/dd-MM-yyyy/);
  });

  it('leaves dates with time tokens and plain strings unchecked', () => {
    expect(validateData(root, { sealed: 'whenever', name: 'x' })).toEqual([]);
  });

  it('leaves a date with no input format unchecked, whatever its shape or type', () => {
    expect(validateData(root, { served: '2024-05-01T10:00:00' })).toEqual([]);
    expect(validateData(root, { served: 'soon' })).toEqual([]);
    expect(validateData(root, { served: 5 })).toEqual([]);
  });

  it('reports dates inside repeat rows with their row index', () => {
    const issues = validateData(root, { items: [{ due: '2020-01-01' }, { due: 'soon' }] });
    expect(issues.map((i) => i.path)).toEqual([['items', 1, 'due']]);
  });
});

describe('renderBlockers', () => {
  it('blocks a render with invalid fields, except in dev mode', () => {
    expect(renderBlockers(root, { issueDate: '234' }, false)).toHaveLength(1);
    expect(renderBlockers(root, { issueDate: '234' }, true)).toEqual([]);
  });
});

describe('paths', () => {
  it('turns a data path into a key and a schema path', () => {
    expect(pathKey(['items', 1, 'due'])).toBe('["items",1,"due"]');
    expect(schemaPathOf(['items', 1, 'due'])).toBe('items[].due');
    expect(schemaPathOf(['a', 'b'])).toBe('a.b');
  });

  it('validates a single value', () => {
    expect(validateValue({ kind: 'string', controls: [], notes: [] }, 'x')).toBeUndefined();
  });
});
