import { normaliseQuotes, resolveScopedPath, schemaPaths, type ObjectSchema } from './schema';
import type { InstructionNode } from './tree';

export interface RenderFailure {
  /** What dtsse-doc-render said was wrong with the instruction. */
  reason: string;
  /** The text between `<<` and `>>`. */
  instruction: string;
  /** The package part the instruction is in, such as `word/document.xml`. */
  part: string;
  /** Where in the part, such as `paragraph 2`. */
  where: string;
}

const ERROR_LINE = /^(.*): <<(.*)>> \((\S+?), (.*)\)$/;

/** Reads each `<reason>: <<instruction>> (part, where)` line of the render error text; lines in another shape are skipped. */
export function parseRenderFailures(text: string): RenderFailure[] {
  const failures: RenderFailure[] = [];
  for (const line of text.split('\n')) {
    const match = ERROR_LINE.exec(line.trim());
    if (match) failures.push({ reason: match[1]!, instruction: match[2]!, part: match[3]!, where: match[4]! });
  }
  return failures;
}

export interface InstructionRefs {
  text: string;
  /** Data the instruction reads, as schema paths such as `items[].name`. */
  paths: string[];
}

/** Every instruction in the template with the schema paths it reads, scoped by the repeats around it. */
export function indexInstructions(tree: InstructionNode[], schema: ObjectSchema): InstructionRefs[] {
  const known = new Set(schemaPaths(schema).map((p) => p.path));
  const out: InstructionRefs[] = [];
  const walk = (nodes: InstructionNode[], scopes: string[]): void => {
    for (const node of nodes) {
      if (node.type === 'comment') continue;
      const paths = node.dataRefs.map((ref) => resolveScopedPath(scopes, ref)).filter((p) => known.has(p));
      if (paths.length > 0) out.push({ text: node.text, paths });
      const named = node.type === 'repeat' ? /^(?:rs|rr)_(\$(?:root|parent|this)\.)?([A-Za-z_][\w.]*)$/.exec(node.text) : null;
      walk(node.children, named ? [...scopes, `${resolveScopedPath(scopes, `${named[1] ?? ''}${named[2]}`)}[]`] : scopes);
    }
  };
  walk(tree, ['']);
  return out;
}

const canonical = (text: string): string => normaliseQuotes(text).replace(/\s+/g, '');

/** The schema paths read by the instruction a failure names, comparing with quote style and spacing ignored. */
export function fieldsForFailure(failure: RenderFailure, index: InstructionRefs[]): string[] {
  const instruction = canonical(failure.instruction);
  const found = new Set<string>();
  for (const entry of index) {
    if (canonical(entry.text) === instruction) entry.paths.forEach((p) => found.add(p));
  }
  return [...found];
}
