import type { TreeNode } from './docx.js';

/** The parts of an instructionTree node that inference reads. */
export interface InstructionNode extends Pick<TreeNode, 'type' | 'text' | 'dataRefs' | 'row'> {
    children: InstructionNode[];
}

export type ScalarKind = 'string' | 'boolean' | 'date';

interface SchemaBase {
    /** Template blocks (for example `cs_isEngland`) whose condition reads this value. */
    controls: string[];
    notes: string[];
}

export interface ScalarSchema extends SchemaBase {
    kind: ScalarKind;
    /** For dates: the format the template parses the stored value with, when it names one. */
    inputFormat?: string;
}

export interface ObjectSchema extends SchemaBase {
    kind: 'object';
    properties: Record<string, Schema>;
}

export interface ArraySchema extends SchemaBase {
    kind: 'array';
    item: ObjectSchema;
}

export type Schema = ScalarSchema | ObjectSchema | ArraySchema;

export interface InferResult {
    root: ObjectSchema;
    warnings: string[];
}

export function normaliseQuotes(text: string): string;
export function inferSchema(tree: InstructionNode[]): InferResult;
export function schemaPaths(schema: ObjectSchema, prefix?: string): { path: string; kind: Schema['kind'] }[];
export function summarise(schema: ObjectSchema): { fields: number; booleans: number; dates: number; repeats: number; strings: number };
export function resolveScopedPath(scopes: string[], ref: string): string;
