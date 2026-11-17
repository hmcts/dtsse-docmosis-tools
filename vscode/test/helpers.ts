import type { InstructionNode } from '../src/tree';

export const field = (text: string, dataRefs: string[] = [text]): InstructionNode => ({ type: 'field', text, dataRefs, children: [] });
export const cond = (text: string, dataRefs: string[], children: InstructionNode[] = [], row = false): InstructionNode => ({
  type: 'condition', text, dataRefs, children, ...(row ? { row } : {}),
});
export const rep = (name: string, children: InstructionNode[] = []): InstructionNode => ({
  type: 'repeat', text: `rs_${name}`, dataRefs: [name], children,
});
export const otherwise = (children: InstructionNode[]): InstructionNode => ({ type: 'else', text: 'else_', dataRefs: [], children });
