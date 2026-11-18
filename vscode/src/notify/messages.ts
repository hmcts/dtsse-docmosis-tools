import type { JsonObject } from '../data';
import type { TemplateType } from './client';

export interface ProductOption {
  id: string;
  label: string;
  vault: string;
  secret: string;
  note?: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  type: TemplateType;
}

export type HostToPicker =
  | { type: 'init'; products: ProductOption[]; selected?: string }
  | { type: 'loading'; product: string; message: string }
  | { type: 'templates'; product: string; templates: TemplateSummary[]; status: string }
  | { type: 'error'; product: string; message: string }
  | { type: 'status'; message: string };

export type PickerToHost =
  | { type: 'ready' }
  | { type: 'selectProduct'; product: string }
  | { type: 'refresh' }
  | { type: 'openTemplate'; template: string };

export interface EditorTemplate {
  id: string;
  name: string;
  type: TemplateType;
  version: number;
  subject: string;
  body: string;
}

export interface Draft {
  subject: string;
  body: string;
  /** The Notify version the draft was started from. */
  baseVersion: number;
}

export interface PreviewContent {
  subject?: string;
  body: string;
  html?: string;
}

export type HostToEditor =
  | {
      type: 'init';
      product: { id: string; label: string };
      template: EditorTemplate;
      data: JsonObject;
      dataPath: string;
      draft?: Draft;
      /** True when Notify's version is newer than the one the draft was started from. */
      staleDraft: boolean;
    }
  | { type: 'loading' }
  | { type: 'loadError'; message: string }
  | { type: 'data'; data: JsonObject }
  | { type: 'previewing'; seq: number }
  | { type: 'preview'; seq: number; request: number; preview: PreviewContent; missing: string[] }
  | { type: 'previewError'; seq: number; request: number; message: string }
  | { type: 'info'; message: string };

export type EditorToHost =
  | { type: 'ready' }
  /** Load the template again after it failed to load. */
  | { type: 'retry' }
  /** `id` increases with every request, so the webview can tell which request a result answers. */
  | { type: 'preview'; id: number; data: JsonObject }
  | { type: 'cancelPreview' }
  | { type: 'dataChanged'; data: JsonObject }
  | { type: 'loadData' }
  | { type: 'saveData'; data: JsonObject }
  | { type: 'saveDraft'; subject: string; body: string }
  | { type: 'discardDraft' }
  | { type: 'copy'; what: 'subject' | 'body'; text: string }
  | { type: 'showDiff'; subject: string; body: string }
  | { type: 'openInNotify' };
