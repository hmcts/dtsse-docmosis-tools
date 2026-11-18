import { describe, expect, it } from 'vitest';
import { normalisePath, parseLibraries } from '../src/library/config';

describe('template library settings', () => {
  it('defaults to no libraries', () => {
    expect(parseLibraries(undefined)).toEqual({ libraries: [], errors: [] });
    expect(parseLibraries([])).toEqual({ libraries: [], errors: [] });
  });

  it('reads repo, ref, path and label', () => {
    const { libraries, errors } = parseLibraries([{ repo: 'acme/letters', ref: 'release', path: '/forms/claims/', label: 'Claims' }]);
    expect(errors).toEqual([]);
    expect(libraries).toEqual([
      { id: 'acme/letters@release:forms/claims', owner: 'acme', repo: 'letters', ref: 'release', path: 'forms/claims', label: 'Claims' },
    ]);
  });

  it('leaves ref unset for the default branch and labels the library by repo and folder', () => {
    const [library] = parseLibraries([{ repo: 'acme/letters', path: 'forms' }]).libraries;
    expect(library?.ref).toBeUndefined();
    expect(library?.label).toBe('acme/letters/forms');
  });

  it('reports entries it cannot use and keeps the rest', () => {
    const { libraries, errors } = parseLibraries([
      'acme/letters',
      { repo: 'acme' },
      { repo: 'acme/letters/extra' },
      { repo: 'acme/letters', path: 'a/../../b' },
      { repo: 'acme/letters', ref: 3 },
      { repo: 'acme/orders' },
    ]);
    expect(libraries.map((l) => l.repo)).toEqual(['orders']);
    expect(errors).toHaveLength(5);
    expect(errors[0]).toMatch(/^entry 1:/);
  });

  it('drops a repeated library', () => {
    expect(parseLibraries([{ repo: 'acme/letters' }, { repo: 'Acme/Letters' }]).libraries).toHaveLength(1);
  });

  it('rejects a setting that is not an array', () => {
    expect(parseLibraries({ repo: 'acme/letters' }).errors).toEqual(['expected an array of libraries']);
  });

  it('normalises folder paths', () => {
    expect(normalisePath('/a//b/./c/')).toBe('a/b/c');
    expect(normalisePath('')).toBe('');
  });
});
