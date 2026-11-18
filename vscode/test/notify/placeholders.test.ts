import { describe, expect, it } from 'vitest';
import { apiPersonalisation, findPlaceholders, isYes, lookup, personalisationSchema, placeholderKey } from '../../src/notify/placeholders';

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
