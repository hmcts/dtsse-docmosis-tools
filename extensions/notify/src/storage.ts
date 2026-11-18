import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { JsonObject } from './data';
import { readSidecar, SIDECAR_FOLDER, writeSidecar } from './sidecar';
import type { Draft } from './messages';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** A template's saved data and draft, in `.hmcts-template-preview/notify/<product>/<template id>/`. */
export class NotifyStorage {
  readonly dataFile: string;
  readonly draftFile: string;

  constructor(
    readonly root: string,
    product: string,
    template: string,
  ) {
    if (!SAFE.test(product) || !SAFE.test(template)) throw new Error(`Unexpected product or template id: ${product}/${template}`);
    const folder = path.join(root, SIDECAR_FOLDER, 'notify', product, template);
    this.dataFile = path.join(folder, 'default.json');
    this.draftFile = path.join(folder, 'draft.json');
  }

  readData(): Promise<JsonObject | undefined> {
    return readSidecar(this.dataFile);
  }

  writeData(data: JsonObject): Promise<void> {
    return writeSidecar(this.root, this.dataFile, data);
  }

  async readDraft(): Promise<Draft | undefined> {
    const saved = await readSidecar(this.draftFile);
    if (!saved) return undefined;
    const { subject, body, baseVersion } = saved;
    if (typeof body !== 'string' || typeof baseVersion !== 'number') return undefined;
    return { subject: typeof subject === 'string' ? subject : '', body, baseVersion };
  }

  writeDraft(draft: Draft): Promise<void> {
    return writeSidecar(this.root, this.draftFile, { ...draft });
  }

  async deleteDraft(): Promise<void> {
    await fs.rm(this.draftFile, { force: true });
  }
}
