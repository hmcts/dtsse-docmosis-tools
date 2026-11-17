import { normaliseQuotes, type InstructionRefs } from './schema';

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
