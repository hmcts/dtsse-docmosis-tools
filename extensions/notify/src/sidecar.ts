import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isObject, type JsonObject } from './data';

/** Shared with the HMCTS Template Preview extension, so saved data and drafts survive the move. */
export const SIDECAR_FOLDER = '.hmcts-template-preview';

/** Creates the sidecar folder with a `*` .gitignore so saved data is never committed. */
async function ensureSidecarFolder(root: string, file: string): Promise<void> {
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

export async function writeSidecar(root: string, file: string, data: JsonObject): Promise<void> {
  await ensureSidecarFolder(root, file);
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}
