import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { LibraryConfig } from './config';
import { readJson, writeAtomic } from './fsutil';
import type { GitHubClient, Template } from './github';

export const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface LibraryIndex {
  version: 1;
  id: string;
  /** The commit the listing came from. */
  commit: string;
  /** The ETag of the commit lookup, for a conditional recheck. */
  etag: string | undefined;
  checkedAt: number;
  templates: Template[];
}

export interface Revalidation {
  index: LibraryIndex;
  /** The commit lookup ran (it didn't fall inside the minimum interval). */
  checked: boolean;
  /** The listing was fetched again because the ref moved. */
  changed: boolean;
}

/** The persisted template listing of each library, rechecked against the ref's commit. */
export class IndexStore {
  private readonly memory = new Map<string, LibraryIndex>();
  private readonly inFlight = new Map<string, { promise: Promise<Revalidation>; client: GitHubClient; force: boolean }>();

  constructor(
    private readonly dir: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  file(id: string): string {
    return path.join(this.dir, `${createHash('sha256').update(id).digest('hex').slice(0, 16)}.json`);
  }

  async load(library: LibraryConfig): Promise<LibraryIndex | undefined> {
    const known = this.memory.get(library.id);
    if (known) return known;
    const stored = await readJson(this.file(library.id));
    if (!isIndex(stored) || stored.id !== library.id) return undefined;
    this.memory.set(library.id, stored);
    return stored;
  }

  /**
   * Rechecks the ref unless it was checked within `minIntervalMs`; refetches the listing only when the commit changed.
   * A call joins a check already running with the same client, unless it is forced and that one isn't. Otherwise it
   * runs after that check, so a forced Refresh, or a new token after signing in, gets a result of its own.
   */
  revalidate(library: LibraryConfig, client: GitHubClient, options: { force?: boolean; minIntervalMs?: number } = {}): Promise<Revalidation> {
    const force = options.force ?? false;
    const running = this.inFlight.get(library.id);
    if (running && running.client === client && (running.force || !force)) return running.promise;
    const after = running ? running.promise.then(noop, noop) : Promise.resolve();
    const entry = { client, force, promise: undefined as unknown as Promise<Revalidation> };
    entry.promise = after
      .then(() => this.run(library, client, options))
      .finally(() => {
        if (this.inFlight.get(library.id) === entry) this.inFlight.delete(library.id);
      });
    this.inFlight.set(library.id, entry);
    return entry.promise;
  }

  private async run(library: LibraryConfig, client: GitHubClient, options: { force?: boolean; minIntervalMs?: number }): Promise<Revalidation> {
    const current = await this.load(library);
    const interval = options.minIntervalMs ?? MIN_CHECK_INTERVAL_MS;
    if (current && !options.force && this.now() - current.checkedAt < interval) {
      return { index: current, checked: false, changed: false };
    }

    const check = await client.commit(library.owner, library.repo, library.ref, current?.etag);
    if (current && (!check.modified || check.sha === current.commit)) {
      const index: LibraryIndex = { ...current, checkedAt: this.now(), etag: check.modified ? check.etag : current.etag };
      await this.save(index);
      return { index, checked: true, changed: false };
    }
    if (!check.modified) throw new Error(`GitHub answered 304 for ${library.owner}/${library.repo} without a cached listing`);

    const templates = await client.templates(library.owner, library.repo, check.sha, library.path);
    const index: LibraryIndex = { version: 1, id: library.id, commit: check.sha, etag: check.etag, checkedAt: this.now(), templates };
    await this.save(index);
    return { index, checked: true, changed: true };
  }

  private async save(index: LibraryIndex): Promise<void> {
    this.memory.set(index.id, index);
    await writeAtomic(this.file(index.id), JSON.stringify(index));
  }
}

const noop = (): void => undefined;

function isIndex(value: unknown): value is LibraryIndex {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<LibraryIndex>;
  return v.version === 1 && typeof v.id === 'string' && typeof v.commit === 'string' && typeof v.checkedAt === 'number' && Array.isArray(v.templates);
}
