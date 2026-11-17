import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InstructionNode } from './tree';

interface DocxLibrary {
  readTemplate(file: string): unknown;
  instructionTree(template: unknown): { part: string; children: InstructionNode[] }[];
}

/** Where the docmosis CLI keeps its template library: bin/docmosis loads ../lib/docx.mjs. */
export function libraryPathFor(cliPath: string): string {
  return path.join(path.dirname(path.dirname(cliPath)), 'lib', 'docx.mjs');
}

export class LibraryMissingError extends Error {
  constructor(readonly libraryPath: string) {
    super(
      `The docmosis template library wasn't found at ${libraryPath}. ` +
        'Clear the hmctsTemplatePreview.docmosisCli setting to use the CLI bundled with the extension, or point it at bin/docmosis in a dtsse-docmosis-tools checkout, which has lib/docx.mjs beside bin/.',
    );
  }
}

/**
 * The only module that reads a .docx. It uses the docmosis CLI's own library at runtime, so the
 * extension and the CLI agree on what a template contains and nothing is copied here.
 */
export async function readInstructionTree(docx: string, libraryPath: string): Promise<InstructionNode[]> {
  let lib: DocxLibrary;
  try {
    lib = (await import(pathToFileURL(libraryPath).href)) as DocxLibrary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') throw new LibraryMissingError(libraryPath);
    throw error;
  }
  return lib.instructionTree(lib.readTemplate(docx)).flatMap((part) => part.children);
}

/**
 * Reads one template's instruction tree, re-reading only when the file's size, mtime or inode or
 * the library path has changed, and sharing a read that is already running. `read` returns the
 * same array while the file is unchanged, so callers can skip work by comparing identity.
 */
export class CachedTemplateReader {
  private cached: { key: string; tree: Promise<InstructionNode[]> } | undefined;

  constructor(
    private readonly docx: string,
    private readonly readTree: (docx: string, libraryPath: string) => Promise<InstructionNode[]> = readInstructionTree,
  ) {}

  async read(libraryPath: string): Promise<InstructionNode[]> {
    const stat = await fs.stat(this.docx);
    const key = `${libraryPath}\0${stat.size}\0${stat.mtimeMs}\0${stat.ino}`;
    if (this.cached?.key !== key) {
      const tree = yieldToEventLoop().then(() => this.readTree(this.docx, libraryPath));
      this.cached = { key, tree };
      tree.catch(() => {
        if (this.cached?.tree === tree) this.cached = undefined;
      });
    }
    return this.cached.tree;
  }
}

/** Lets pending messages and timers run before a synchronous parse holds the thread. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));
