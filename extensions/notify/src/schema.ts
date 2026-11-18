export type ScalarKind = 'string' | 'boolean' | 'date';

interface SchemaBase {
  controls: string[];
  notes: string[];
}

export interface ScalarSchema extends SchemaBase {
  kind: ScalarKind;
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
