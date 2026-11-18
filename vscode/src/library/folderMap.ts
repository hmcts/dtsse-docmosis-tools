import type { LibraryConfig } from './config';
import type { Template } from './github';

export interface FolderContents {
  /** Child folders, as paths relative to the library's folder. */
  folders: string[];
  files: Template[];
}

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare;
export const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1);
export const relativeTo = (prefix: string, file: string): string =>
  prefix && file.startsWith(`${prefix}/`) ? file.slice(prefix.length + 1) : file;
export const dirName = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/** A library's templates grouped by folder, built in one pass and sorted per folder on first use. */
export class FolderMap {
  private readonly folders = new Map<string, { folders: Set<string>; files: Template[]; sorted?: FolderContents }>();

  constructor(templates: readonly Template[], readonly prefix: string) {
    this.entry('');
    for (const template of templates) {
      let folder = dirName(relativeTo(prefix, template.path));
      this.entry(folder).files.push(template);
      while (folder !== '') {
        const parent = dirName(folder);
        const siblings = this.entry(parent).folders;
        if (siblings.has(folder)) break;
        siblings.add(folder);
        folder = parent;
      }
    }
  }

  children(folder: string): FolderContents {
    const entry = this.folders.get(folder);
    if (!entry) return { folders: [], files: [] };
    entry.sorted ??= {
      folders: [...entry.folders].sort((a, b) => byName(baseName(a), baseName(b))),
      files: [...entry.files].sort((a, b) => byName(baseName(a.path), baseName(b.path))),
    };
    return entry.sorted;
  }

  private entry(folder: string) {
    let entry = this.folders.get(folder);
    if (!entry) {
      entry = { folders: new Set(), files: [] };
      this.folders.set(folder, entry);
    }
    return entry;
  }
}

export interface SearchItem {
  label: string;
  description: string;
  library: LibraryConfig;
  template: Template;
}

/** One QuickPick row per template; the description names the folder, and the library when there are several. */
export function searchItems(listings: ReadonlyArray<{ library: LibraryConfig; templates: readonly Template[] }>): SearchItem[] {
  const several = listings.length > 1;
  const items: SearchItem[] = [];
  for (const { library, templates } of listings) {
    for (const template of templates) {
      const folder = dirName(relativeTo(library.path, template.path));
      const description = several ? (folder ? `${library.label} · ${folder}` : library.label) : folder;
      items.push({ label: baseName(template.path), description, library, template });
    }
  }
  return items.sort((a, b) => byName(a.label, b.label) || byName(a.description, b.description));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
