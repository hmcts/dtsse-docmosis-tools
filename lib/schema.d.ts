import type { TreeNode } from './docx.js';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** The parts of an instructionTree node that inference reads. */
export interface InstructionNode extends Pick<TreeNode, 'type' | 'text' | 'dataRefs' | 'row'> {
    children: InstructionNode[];
    location?: { part: string; paragraph: number; label?: string };
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

export interface InstructionRefs {
    /** The instruction's text. */
    text: string;
    /** The schema paths it reads, as `schemaPaths` writes them. */
    paths: string[];
}

export interface InferResult {
    root: ObjectSchema;
    warnings: string[];
    /** For each instruction that reads data, the schema paths it reads. */
    refs: InstructionRefs[];
}

export function normaliseQuotes(text: string): string;
/** `refs: false` skips building `refs`, which is returned empty. */
export function inferSchema(tree: InstructionNode[], options?: { refs?: boolean }): InferResult;
export function schemaPaths(schema: ObjectSchema, prefix?: string): { path: string; kind: Schema['kind'] }[];
/** Every path a schema names, objects and arrays as well as leaves, in the form `schemaPaths` writes them. */
export function nodePaths(schema: ObjectSchema, prefix?: string): string[];
export function summarise(schema: ObjectSchema): { fields: number; booleans: number; dates: number; repeats: number; strings: number };
/** RegExp source for one data name, with an optional `$root`, `$parent` or `$this` prefix, spaces around dots and `[n]` indexes. */
export const NAME_SOURCE: string;
/** RegExp source for one step of a path: `.name` or `[n]`. */
export const STEP_SOURCE: string;
/** Resolves a name against the scope paths (outermost first; null for an unnamed scope) to a schema path such as `items[].x`. */
export function resolveRef(scopes: (string | null)[], ref: string): string | null;
