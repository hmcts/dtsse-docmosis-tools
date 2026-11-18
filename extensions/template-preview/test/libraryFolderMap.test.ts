import { describe, expect, it } from 'vitest';
import { parseLibraries } from '../src/library/config';
import { FolderMap, formatSize, searchItems } from '../src/library/folderMap';

const t = (path: string) => ({ path, sha: `sha-${path}`, size: 1 });

describe('template folder map', () => {
  it('groups templates by folder relative to the library folder, folders before files, in natural order', () => {
    const map = new FolderMap([t('forms/b/X.docx'), t('forms/a/deep/Y.docx'), t('forms/Z10.docx'), t('forms/Z9.docx')], 'forms');
    expect(map.children('')).toEqual({ folders: ['a', 'b'], files: [t('forms/Z9.docx'), t('forms/Z10.docx')] });
    expect(map.children('a')).toEqual({ folders: ['a/deep'], files: [] });
    expect(map.children('a/deep').files).toEqual([t('forms/a/deep/Y.docx')]);
    expect(map.children('missing')).toEqual({ folders: [], files: [] });
  });

  it('builds a large flat folder quickly and returns the same sorted children each time', () => {
    const templates = Array.from({ length: 5000 }, (_, i) => t(`flat/T-${String(5000 - i).padStart(4, '0')}.docx`));
    const start = performance.now();
    const map = new FolderMap(templates, '');
    const first = map.children('flat');
    expect(performance.now() - start).toBeLessThan(500);
    expect(first.files).toHaveLength(5000);
    expect(first.files[0]?.path).toBe('flat/T-0001.docx');
    expect(map.children('flat')).toBe(first);
    expect(map.children('').folders).toEqual(['flat']);
  });

  it('names the folder in search rows, and the library when there are several', () => {
    const [letters, orders] = parseLibraries([
      { repo: 'acme/letters', path: 'forms', label: 'Letters' },
      { repo: 'acme/orders', label: 'Orders' },
    ]).libraries;
    const one = searchItems([{ library: letters!, templates: [t('forms/sub/B.docx'), t('forms/A.docx')] }]);
    expect(one.map(({ label, description }) => ({ label, description }))).toEqual([
      { label: 'A.docx', description: '' },
      { label: 'B.docx', description: 'sub' },
    ]);
    const two = searchItems([
      { library: letters!, templates: [t('forms/A.docx')] },
      { library: orders!, templates: [t('x/A.docx')] },
    ]);
    expect(two.map((item) => item.description)).toEqual(['Letters', 'Orders · x']);
  });

  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(40 * 1024)).toBe('40 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
