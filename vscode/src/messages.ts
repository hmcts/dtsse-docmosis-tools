import type { JsonObject } from './data';
import type { ObjectSchema } from './schema';
import type { FieldIssue } from './validate';

export interface TemplateInfo {
  name: string;
  schema: ObjectSchema;
  warnings: string[];
}

export type HostToWebview =
  | { type: 'init'; template: TemplateInfo; data: JsonObject; dataPath: string; workerUri: string; dev: boolean }
  | { type: 'template'; template: TemplateInfo }
  | { type: 'data'; data: JsonObject }
  | { type: 'rendering'; seq: number }
  | { type: 'pdf'; seq: number; request: number; bytes: Uint8Array }
  | { type: 'renderError'; seq: number; request: number; message: string; fields: { path: string; reason: string }[] }
  | { type: 'invalid'; request: number; issues: FieldIssue[] }
  | { type: 'info'; message: string }
  | { type: 'templateError'; message: string };

export type WebviewToHost =
  | { type: 'ready' }
  /** `id` increases with every request, so the webview can tell which request a result answers. */
  | { type: 'render'; id: number; data: JsonObject; dev: boolean }
  | { type: 'cancelRender' }
  | { type: 'loadData' }
  | { type: 'saveData'; data: JsonObject }
  | { type: 'openPdf' };
