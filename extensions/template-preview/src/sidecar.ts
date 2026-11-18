import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isObject, type JsonObject } from './data';

export const SIDECAR_FOLDER = '.hmcts-template-preview';

/** An 8-character hash of a path, to tell apart templates that share a file name. */
export const shortHash = (file: string): string => createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 8);

/**
 * The template's path relative to the workspace, without its extension, as the sidecar folder
 * name: `docs/X.docx` saves to `.hmcts-template-preview/docs/X/default.json`.
 * A template outside the workspace uses `_external/<name>-<hash>`.
 */
function sidecarKey(root: string, docx: string): string {
  const name = path.basename(docx, path.extname(docx));
  const relative = path.relative(root, path.join(path.dirname(docx), name));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.join('_external', `${name}-${shortHash(docx)}`);
  }
  return relative;
}

export function sidecarPath(root: string, docx: string): string {
  return path.join(root, SIDECAR_FOLDER, sidecarKey(root, docx), 'default.json');
}

/** Where earlier versions saved data, keyed by the template's file name alone. */
export function legacySidecarPath(root: string, docx: string): string {
  return path.join(root, SIDECAR_FOLDER, path.basename(docx, path.extname(docx)), 'default.json');
}

/** Creates the sidecar folder with a `*` .gitignore so saved data is never committed. */
export async function ensureSidecarFolder(root: string, file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const ignore = path.join(root, SIDECAR_FOLDER, '.gitignore');
  await fs.writeFile(ignore, '*\n', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

export async function readSidecar(file: string): Promise<JsonObject | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return isObject(parsed) ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Reads the template's sidecar, falling back to the file-name-keyed one earlier versions wrote.
 * The fallback is left in place; the data is saved to the new path on the next render or save.
 */
export async function readTemplateSidecar(root: string, docx: string): Promise<{ data: JsonObject; from: string } | undefined> {
  const file = sidecarPath(root, docx);
  const data = await readSidecar(file);
  if (data) return { data, from: file };
  const legacy = legacySidecarPath(root, docx);
  if (legacy === file) return undefined;
  const old = await readSidecar(legacy);
  return old ? { data: old, from: legacy } : undefined;
}

export async function writeSidecar(root: string, file: string, data: JsonObject): Promise<void> {
  await ensureSidecarFolder(root, file);
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}
