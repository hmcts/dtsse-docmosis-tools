declare module '@hmcts-cft/docmosis-tools' {
  export class RenderError extends Error {
    status: number;
    shortMsg: string;
    longMsg: string;
    lines: string[];
  }
  export class RenderUnreachable extends Error {}
  export interface RenderFileOptions {
    template: Buffer | string;
    data: object | string;
    format?: string;
    devMode?: boolean;
    url?: string;
    fetchImpl?: typeof fetch;
  }
  export function renderFile(options: RenderFileOptions): Promise<{ bytes: Buffer; contentType: string; format: string }>;
  export function readTemplate(file: string): unknown;
  export function instructionTree(template: unknown): { part: string; children: import('./tree').InstructionNode[] }[];
}
