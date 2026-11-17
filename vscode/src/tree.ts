export type InstructionType = 'field' | 'condition' | 'repeat' | 'else' | 'comment';

/** One Docmosis instruction, in the shape of the docmosis library's `instructionTree`. */
export interface InstructionNode {
  type: InstructionType;
  text: string;
  dataRefs: string[];
  /** What a block (condition, repeat or else branch) encloses. */
  children: InstructionNode[];
  /** True for row-level blocks (cr_ / rr_). */
  row?: boolean;
  location?: { part: string; paragraph: number; label?: string };
}
