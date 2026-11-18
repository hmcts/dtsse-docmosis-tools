import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readJson, writeAtomic } from './fsutil';
import type { Template } from './github';

type Manifest = Record<string, string>;

/** Git's object id for a blob, which the tree listing gives as `sha`. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

/**
 * Downloaded templates, each at a path fixed by its repo and path in the repo, so a newer
 * version replaces the file in place. A manifest per repo records the blob each file holds.
 */
export class BlobCache {
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  file(owner: string, repo: string, repoPath: string): string {
    const base = path.join(this.root, 'libraries', owner, repo);
    const file = path.join(base, ...repoPath.split('/'));
    if (!file.startsWith(base + path.sep)) throw new Error(`Refusing to cache ${repoPath} outside ${base}`);
    return file;
  }

  private manifestFile(owner: string, repo: string): string {
    return path.join(this.root, 'library-manifests', owner, `${repo}.json`);
  }

  private async manifest(owner: string, repo: string): Promise<Manifest> {
    const stored = await readJson(this.manifestFile(owner, repo));
    return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Manifest) : {};
  }

  /** The cached file when it holds `template`'s blob. */
  async cached(owner: string, repo: string, template: Template): Promise<string | undefined> {
    const file = this.file(owner, repo, template.path);
    if ((await this.manifest(owner, repo))[template.path] !== template.sha) return undefined;
    try {
      await fs.access(file);
      return file;
    } catch {
      return undefined;
    }
  }

  /** The cached file for `template`, downloading it first when the cache is missing or older. */
  async ensure(
    owner: string,
    repo: string,
    template: Template,
    download: () => Promise<Uint8Array>,
  ): Promise<{ file: string; downloaded: boolean }> {
    const hit = await this.cached(owner, repo, template);
    if (hit) return { file: hit, downloaded: false };

    const bytes = await download();
    const actual = gitBlobSha(bytes);
    if (actual !== template.sha) throw new Error(`Downloaded ${template.path} doesn't match its listing (blob ${actual}, expected ${template.sha}).`);
    const file = this.file(owner, repo, template.path);
    await writeAtomic(file, bytes);
    await this.record(owner, repo, template);
    return { file, downloaded: true };
  }

  /** Serialised per repo, and merged with the manifest on disk, which other windows also write. */
  private record(owner: string, repo: string, template: Template): Promise<void> {
    const key = this.manifestFile(owner, repo);
    const previous = this.writes.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const manifest = await this.manifest(owner, repo);
      manifest[template.path] = template.sha;
      await writeAtomic(key, JSON.stringify(manifest));
    });
    this.writes.set(key, next);
    return next;
  }
}
