import { describe, expect, it } from 'vitest';
import { apiPersonalisation, dataKey, findPlaceholders, formValues, isYes, lookup, personalisationSchema, placeholderKey } from '../../src/notify/placeholders';

describe('findPlaceholders', () => {
  it('finds plain and conditional placeholders in the subject and body, in order', () => {
    const found = findPlaceholders('Your case ((case number))', 'Dear ((name)),\n((has_hearing??Your hearing is listed.))\n((date))');
    expect(found.map((p) => [p.name, p.conditional])).toEqual([
      ['case number', false],
      ['name', false],
      ['has_hearing', true],
      ['date', false],
    ]);
  });

  it('matches names as Notify does, ignoring case, spaces, underscores and hyphens', () => {
    expect(placeholderKey(' First_Name ')).toBe('firstname');
    const found = findPlaceholders('((First name)) ((first_name)) ((FIRST-NAME))');
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe('First name');
  });

  it('treats a name used both ways as text', () => {
    const [p] = findPlaceholders('((urgent??URGENT: )) ((urgent))');
    expect(p).toMatchObject({ name: 'urgent', conditional: false, shows: ['URGENT: '] });
  });

  it('ignores empty and unclosed placeholders', () => {
    expect(findPlaceholders('(( )) ((name) (name))')).toEqual([]);
  });
});

describe('personalisationSchema', () => {
  it('builds text inputs and checkboxes for the existing form', () => {
    expect(personalisationSchema(findPlaceholders('((name)) ((welsh??Cymraeg))'))).toEqual({
      kind: 'object',
      controls: [],
      notes: [],
      properties: {
        name: { kind: 'string', controls: [], notes: [] },
        welsh: { kind: 'boolean', controls: [], notes: ['Shows: "Cymraeg"'] },
      },
    });
  });
});

describe('apiPersonalisation', () => {
  it('sends values, yes or no for conditionals, and ((name)) for anything missing', () => {
    const placeholders = findPlaceholders('((name)) ((date)) ((items)) ((welsh??x)) ((urgent??y))');
    expect(apiPersonalisation(placeholders, { Name: 'Ann', items: ['a', 'b'], welsh: true })).toEqual({
      personalisation: { name: 'Ann', date: '((date))', items: ['a', 'b'], welsh: 'yes', urgent: 'no' },
      missing: ['date'],
    });
  });
});

describe('lookup and isYes', () => {
  it('looks values up by Notify name', () => {
    expect(lookup({ first_name: 'Ann' }, 'First Name')).toBe('Ann');
    expect(lookup({}, 'x')).toBeUndefined();
  });

  it('counts true, yes, y and 1 as yes', () => {
    expect([true, 'yes', 'Y', 'true', '1'].every(isYes)).toBe(true);
    expect([false, 'no', '', undefined, 'maybe'].some(isYes)).toBe(false);
  });
});

describe('the personalisation form', () => {
  const placeholders = findPlaceholders('Dear ((First name)), case ((case_ref)). ((remote??By video.)) ((items))');

  it('shows saved data the way the previews read it', () => {
    expect(formValues(placeholders, { first_name: 'Ann', 'CASE-REF': 123, Remote: 'yes', items: ['a', 'b'] })).toEqual({
      'First name': 'Ann',
      case_ref: '123',
      remote: true,
      items: '["a","b"]',
    });
    expect(formValues(placeholders, { remote: 'no' })).toEqual({ remote: false });
  });

  it('edits the key the data already has for a placeholder', () => {
    expect(dataKey({ first_name: 'Ann' }, 'First name')).toBe('first_name');
    expect(dataKey({ 'First name': 'Ann', first_name: 'Bob' }, 'First name')).toBe('First name');
    expect(dataKey({}, 'First name')).toBe('First name');
    expect(lookup({}, 'constructor')).toBeUndefined();
  });
});
