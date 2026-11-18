import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readJson, writeAtomic } from './fsutil';
import type { Template } from './github';

type Manifest = Record<string, string>;

/** Where a template comes from: the repo and the ref the library lists. */
export interface BlobSource {
  owner: string;
  repo: string;
  /** Undefined means the repo's default branch. */
  ref: string | undefined;
}

/** Git's object id for a blob, which the tree listing gives as `sha`. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex'); // NOSONAR: git's blob id is SHA-1; this checks the download against the listing, not authenticity
}

/**
 * One folder name per ref. The readable part keeps only filesystem-safe characters, and the hash of
 * the whole ref keeps refs apart that differ only in case or in the characters replaced, so a ref
 * containing `/` stays one folder. No ref maps to `default`, which is the default branch's.
 */
export function refFolder(ref: string | undefined): string {
  if (ref === undefined) return 'default';
  const readable = ref.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 48);
  return `${readable}-${createHash('sha256').update(ref).digest('hex').slice(0, 10)}`;
}

/**
 * Downloaded templates, each at a path fixed by its repo, ref and path in the repo, so a newer
 * version from the same ref replaces the file in place. A manifest per repo and ref records the blob
 * each file holds.
 */
export class BlobCache {
  private readonly writes = new Map<string, Promise<unknown>>();
  /** Parsed manifests, reused while the file on disk is the one they were read from. */
  private readonly manifests = new Map<string, { ino: number; mtimeMs: number; manifest: Manifest }>();

  constructor(private readonly root: string) {}

  private folder(kind: 'libraries' | 'library-manifests', source: BlobSource): string {
    return path.join(this.root, kind, source.owner.toLowerCase(), source.repo.toLowerCase(), refFolder(source.ref));
  }

  file(source: BlobSource, repoPath: string): string {
    const base = this.folder('libraries', source);
    const file = path.join(base, ...repoPath.split('/'));
    if (!file.startsWith(base + path.sep)) throw new Error(`Refusing to cache ${repoPath} outside ${base}`);
    return file;
  }

  private manifestFile(source: BlobSource): string {
    return `${this.folder('library-manifests', source)}.json`;
  }

  /** Other windows write the manifest too, so it is read again whenever the file has been replaced. */
  private async manifest(file: string): Promise<Manifest> {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.manifests.delete(file);
      return {};
    }
    const known = this.manifests.get(file);
    if (known && known.ino === stat.ino && known.mtimeMs === stat.mtimeMs) return known.manifest;
    const stored = await readJson(file);
    const manifest = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Manifest) : {};
    this.manifests.set(file, { ino: stat.ino, mtimeMs: stat.mtimeMs, manifest });
    return manifest;
  }

  /** The cached file when it holds `template`'s blob. */
  async cached(source: BlobSource, template: Template): Promise<string | undefined> {
    const file = this.file(source, template.path);
    if ((await this.manifest(this.manifestFile(source)))[template.path] !== template.sha) return undefined;
    try {
      await fs.access(file);
      return file;
    } catch {
      return undefined;
    }
  }

  /** The cached file for `template`, downloading it first when the cache is missing or older. */
  async ensure(source: BlobSource, template: Template, download: () => Promise<Uint8Array>): Promise<{ file: string; downloaded: boolean }> {
    const hit = await this.cached(source, template);
    if (hit) return { file: hit, downloaded: false };

    const bytes = await download();
    const actual = gitBlobSha(bytes);
    if (actual !== template.sha) throw new Error(`Downloaded ${template.path} doesn't match its listing (blob ${actual}, expected ${template.sha}).`);
    const file = this.file(source, template.path);
    await writeAtomic(file, bytes);
    await this.record(source, template);
    return { file, downloaded: true };
  }

  /** Serialised per manifest, and merged with the manifest on disk, which other windows also write. */
  private record(source: BlobSource, template: Template): Promise<void> {
    const key = this.manifestFile(source);
    const previous = this.writes.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const manifest = { ...(await this.manifest(key)), [template.path]: template.sha };
      this.manifests.delete(key);
      await writeAtomic(key, JSON.stringify(manifest));
    });
    this.writes.set(key, next);
    return next;
  }
}
