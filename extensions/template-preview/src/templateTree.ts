import * as fs from 'node:fs/promises';
import { readTemplate, templateInstructions } from '@hmcts-cft/docmosis-tools';
import type { InstructionNode } from './tree';

/** The only module that reads a .docx, through the docmosis template library, so the extension and the CLI agree on what a template contains. */
export async function readInstructionTree(docx: string): Promise<InstructionNode[]> {
  return templateInstructions(readTemplate(docx));
}

/**
 * Reads one template's instruction tree, re-reading only when the file's size, mtime or inode has changed
 * and sharing a read that is already running. `read` returns the
 * same array while the file is unchanged, so callers can skip work by comparing identity.
 */
export class CachedTemplateReader {
  private cached: { key: string; tree: Promise<InstructionNode[]> } | undefined;

  constructor(
    private readonly docx: string,
    private readonly readTree: (docx: string) => Promise<InstructionNode[]> = readInstructionTree,
  ) {}

  async read(): Promise<InstructionNode[]> {
    const stat = await fs.stat(this.docx);
    const key = `${stat.size}\0${stat.mtimeMs}\0${stat.ino}`;
    if (this.cached?.key !== key) {
      const tree = yieldToEventLoop().then(() => this.readTree(this.docx));
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
