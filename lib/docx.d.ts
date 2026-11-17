export class DocxError extends Error {
    constructor(message: string, options?: { exitCode?: number; details?: string[] });
    exitCode: number;
    details?: string[];
}

export interface TemplatePart {
    name: string;
    xml: string;
}

export interface Template {
    path: string;
    parts: TemplatePart[];
}

/** A .docx path, a folder made by unpack(), or the object readTemplate() returns. */
export type TemplateInput = string | { parts: TemplatePart[]; path?: string };

export interface Problem {
    level: 'error' | 'warning' | 'info';
    part: string;
    loc?: string;
    msg: string;
}

export interface CheckResult {
    instructions: number;
    errors: number;
    warnings: number;
    problems: Problem[];
}

export interface Located {
    text: string;
    part: string;
    path: string[];
    loc: string;
}

export interface DiffResult {
    added: Located[];
    removed: Located[];
    moved: { from: Located; to: Located }[];
    oldCount: number;
    newCount: number;
}

export interface TreeNode {
    type: 'field' | 'condition' | 'repeat' | 'else' | 'comment';
    text: string;
    dataRefs: string[];
    children: TreeNode[];
    row?: boolean;
    location: { part: string; paragraph: number; cells: { table: number; row: number; cell: number }[]; label: string };
    [key: string]: unknown;
}

export const ELSE_MARK: string;

export function readTemplate(path: string): Template;
export function dataRefs(instruction: string): string[];
export function text(template: TemplateInput): { part: string; lines: { kind: 'para' | 'row'; loc: string; text: string }[] }[];
export function fields(template: TemplateInput): Record<string, unknown>[];
export function instructionTree(template: TemplateInput): { part: string; children: TreeNode[] }[];
export function check(template: TemplateInput): CheckResult;
export function diff(oldTemplate: TemplateInput, newTemplate: TemplateInput): DiffResult;
export function unpack(file: string, dir: string): unknown;
export function pack(dir: string, file: string): { dir: string; file: string; skipped: string[] };
export function xmlProblem(xml: string): string | null;
export function main(argv: string[]): number;
