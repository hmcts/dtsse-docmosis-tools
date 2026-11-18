import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacySidecarPath, readSidecar, readTemplateSidecar, sidecarPath, writeSidecar } from '../src/sidecar';

describe('sidecar', () => {
  it('lives under .hmcts-template-preview/<workspace-relative path>/default.json', () => {
    expect(sidecarPath('/ws', '/ws/Templates/CV-Claim.docx')).toBe('/ws/.hmcts-template-preview/Templates/CV-Claim/default.json');
  });

  it('keeps templates with the same file name in different folders apart', () => {
    const base = sidecarPath('/ws', '/ws/a/X.docx');
    const b = sidecarPath('/ws', '/ws/b/X.docx');
    expect(base).toBe('/ws/.hmcts-template-preview/a/X/default.json');
    expect(b).toBe('/ws/.hmcts-template-preview/b/X/default.json');
  });

  it('keys a template outside the workspace by its name and a hash of its path', () => {
    const a = sidecarPath('/ws', '/elsewhere/a/X.docx');
    const b = sidecarPath('/ws', '/elsewhere/b/X.docx');
    expect(a).toMatch(/^\/ws\/\.hmcts-template-preview\/_external\/X-[0-9a-f]{8}\/default\.json$/);
    expect(a).not.toBe(b);
  });

  it('writes the data and a .gitignore that ignores everything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-sidecar-'));
    const file = sidecarPath(root, join(root, 'T.docx'));
    await writeSidecar(root, file, { a: 'x' });
    expect(await readSidecar(file)).toEqual({ a: 'x' });
    expect(await readFile(join(root, '.hmcts-template-preview', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it("doesn't overwrite an existing .gitignore", async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-sidecar-'));
    const file = sidecarPath(root, join(root, 'T.docx'));
    await writeSidecar(root, file, {});
    await writeSidecar(root, file, { b: 1 });
    expect(await readFile(join(root, '.hmcts-template-preview', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('returns undefined for a missing file and throws for invalid JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-sidecar-'));
    expect(await readSidecar(join(root, 'nope.json'))).toBeUndefined();
    const bad = join(root, 'bad.json');
    await writeFile(bad, '{');
    await expect(readSidecar(bad)).rejects.toThrow();
  });
});

describe('readTemplateSidecar', () => {
  it('falls back to the file-name-keyed sidecar earlier versions wrote', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-sidecar-'));
    const docx = join(root, 'Templates', 'Base', 'X.docx');
    const legacy = legacySidecarPath(root, docx);
    expect(legacy).toBe(join(root, '.hmcts-template-preview', 'X', 'default.json'));
    await mkdir(join(legacy, '..'), { recursive: true });
    await writeFile(legacy, '{"old":true}');
    expect(await readTemplateSidecar(root, docx)).toEqual({ data: { old: true }, from: legacy });
  });

  it('prefers the path-keyed sidecar once it exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-sidecar-'));
    const docx = join(root, 'Templates', 'Base', 'X.docx');
    await writeSidecar(root, legacySidecarPath(root, docx), { old: true });
    await writeSidecar(root, sidecarPath(root, docx), { current: true });
    expect(await readTemplateSidecar(root, docx)).toEqual({ data: { current: true }, from: sidecarPath(root, docx) });
  });

  it('returns undefined when neither exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-sidecar-'));
    expect(await readTemplateSidecar(root, join(root, 'X.docx'))).toBeUndefined();
    expect(await readTemplateSidecar(root, join(root, 'a', 'X.docx'))).toBeUndefined();
  });
});
