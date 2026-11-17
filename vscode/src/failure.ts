import { normaliseQuotes, schemaPaths, type ObjectSchema } from './schema';
import type { InstructionNode } from './tree';

export interface RenderFailure {
  /** The instruction Docmosis names after `Field <<...>>`. */
  instruction?: string;
  /** The expression in `Unable to evaluate ... expression [...]`. */
  expression?: string;
  /** What Docmosis said was wrong, after the expression. */
  reason?: string;
}

/** Pulls the failing instruction out of the CLI's error text, which usually embeds Docmosis's JSON reply. */
export function parseRenderFailure(text: string): RenderFailure {
  const detail = shortMessage(text);
  const failure: RenderFailure = {};
  const instruction = /Field\s*<<([\s\S]*?)>>(?=\s|$)/.exec(detail);
  if (instruction) failure.instruction = instruction[1]!;
  const expression = /Unable to evaluate [\w ]*?expression\s*\[([\s\S]*?)\]:\s*([\s\S]*)$/.exec(detail);
  if (expression) {
    failure.expression = expression[1]!;
    failure.reason = expression[2]!.trim();
  }
  return failure;
}

function shortMessage(text: string): string {
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
      if (typeof parsed === 'object' && parsed !== null && 'shortMsg' in parsed && typeof parsed.shortMsg === 'string') {
        return parsed.shortMsg;
      }
    } catch {
      // not JSON; use the text as it is
    }
  }
  return text;
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
  const walk = (nodes: InstructionNode[], scope: string): void => {
    for (const node of nodes) {
      if (node.type === 'comment') continue;
      const paths = node.dataRefs.map((ref) => (scope ? `${scope}.${ref}` : ref)).filter((p) => known.has(p));
      if (paths.length > 0) out.push({ text: node.text, paths });
      const named = node.type === 'repeat' ? /^(?:rs|rr)_([A-Za-z_][\w.]*)$/.exec(node.text) : null;
      walk(node.children, named ? `${scope ? `${scope}.` : ''}${named[1]}[]` : scope);
    }
  };
  walk(tree, '');
  return out;
}

const canonical = (text: string): string => normaliseQuotes(text).replace(/\s+/g, '');

/** The schema paths read by the instruction a failure names, comparing with quote style and spacing ignored. */
export function fieldsForFailure(failure: RenderFailure, index: InstructionRefs[]): string[] {
  const instruction = failure.instruction === undefined ? undefined : canonical(failure.instruction);
  const expression = failure.expression === undefined ? undefined : canonical(failure.expression);
  if (!instruction && !expression) return [];
  const found = new Set<string>();
  for (const entry of index) {
    const text = canonical(entry.text);
    const exact = instruction !== undefined && (text === instruction);
    const contains = expression !== undefined && text.includes(expression);
    if (exact || contains) entry.paths.forEach((p) => found.add(p));
  }
  return [...found];
}
