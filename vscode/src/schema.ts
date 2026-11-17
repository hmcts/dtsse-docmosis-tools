import type { InstructionNode } from './tree';

export type ScalarKind = 'string' | 'boolean' | 'date';

interface SchemaBase {
  /** Template blocks (for example `cs_isEngland`) whose condition reads this value. */
  controls: string[];
  notes: string[];
}

export interface ScalarSchema extends SchemaBase {
  kind: ScalarKind;
  /** For dates: the format the template parses the stored value with, when the template names one. */
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

/** Rewrites typographic quotes, which Word inserts and Docmosis accepts, as straight ones. */
export function normaliseQuotes(text: string): string {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

const BLANK_NOTE = 'The template only tests whether this is blank or null.';

type Use = 'string' | 'boolean' | 'date' | 'unknown';

/** Infers the data a template expects from its instruction tree. */
export function inferSchema(tree: InstructionNode[]): InferResult {
  return new Inferrer().run(tree);
}

const dateSchema = (inputFormat: string | undefined): ScalarSchema => ({
  kind: 'date',
  controls: [],
  notes: [],
  ...(inputFormat ? { inputFormat } : {}),
});

const newObject = (): ObjectSchema => ({ kind: 'object', controls: [], notes: [], properties: {} });

class Inferrer {
  private readonly warnings: string[] = [];
  /** Scalars seen only in blank/null tests, so any stronger later use can replace them. */
  private readonly weak = new Set<Schema>();

  run(tree: InstructionNode[]): InferResult {
    const root = newObject();
    this.walk(tree, root);
    return { root, warnings: this.warnings };
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  private walk(nodes: InstructionNode[], scope: ObjectSchema): void {
    for (const node of nodes) {
      switch (node.type) {
        case 'comment':
          break;
        case 'field':
          this.expression(node, scope, undefined);
          break;
        case 'condition':
          this.condition(node, scope);
          this.walk(node.children, scope);
          break;
        case 'repeat':
          this.walk(node.children, this.repeat(node, scope));
          break;
        case 'else':
          this.walk(node.children, scope);
          break;
      }
    }
  }

  private condition(node: InstructionNode, scope: ObjectSchema): void {
    const bare = /^(?:cs|cr)_\{?\s*!?\s*([A-Za-z_][\w.]*)\s*\}?$/.exec(node.text);
    if (bare) {
      this.use(scope, bare[1]!, 'boolean', { control: node.text });
      return;
    }
    this.expression(node, scope, node.text);
  }

  private repeat(node: InstructionNode, scope: ObjectSchema): ObjectSchema {
    const named = /^(?:rs|rr)_([A-Za-z_][\w.]*)$/.exec(node.text);
    if (!named) {
      this.expression(node, scope, undefined);
      return scope;
    }
    const segments = named[1]!.split('.');
    const parent = this.parentOf(scope, segments);
    const key = segments[segments.length - 1]!;
    const existing = parent.properties[key];
    if (!existing) {
      const array: ArraySchema = { kind: 'array', controls: [], notes: [], item: newObject() };
      parent.properties[key] = array;
      return array.item;
    }
    if (existing.kind === 'array') return existing.item;
    if (existing.kind === 'object') {
      this.warn(`"${named[1]}" is used as both an object and a repeat; its repeat rows are ignored.`);
      return newObject();
    }
    const array: ArraySchema = { kind: 'array', controls: existing.controls, notes: existing.notes, item: newObject() };
    if (existing.kind !== 'boolean') {
      this.warn(`"${named[1]}" is used as both ${existing.kind} and a repeat; treated as a repeat.`);
    }
    parent.properties[key] = array;
    return array.item;
  }

  private expression(node: InstructionNode, scope: ObjectSchema, control: string | undefined): void {
    const body = normaliseQuotes(node.text.replace(/^(?:cs|cr|rs|rr)_/, ''));
    const dates = new Map<string, string | undefined>();
    for (const m of body.matchAll(/\bdateFormat\(\s*([A-Za-z_][\w.]*)\s*,\s*(?:'[^']*'|"[^"]*")\s*(?:,\s*(?:'([^']*)'|"([^"]*)"))?\s*\)/g)) {
      dates.set(m[1]!, m[2] ?? m[3]);
    }
    const blankTested = new Set<string>();
    for (const m of body.matchAll(/\bisBlank\(\s*([A-Za-z_][\w.]*)\s*\)|\b([A-Za-z_][\w.]*)\s*[!=]=\s*null\b|\bnull\s*[!=]=\s*([A-Za-z_][\w.]*)/g)) {
      blankTested.add(m[1] ?? m[2] ?? m[3]!);
    }
    for (const ref of node.dataRefs) {
      const options = { control };
      if (dates.has(ref)) this.use(scope, ref, 'date', { ...options, inputFormat: dates.get(ref) });
      else if (blankTested.has(ref)) this.use(scope, ref, 'unknown', { ...options, note: BLANK_NOTE });
      else this.use(scope, ref, 'string', options);
    }
  }

  private parentOf(scope: ObjectSchema, segments: string[]): ObjectSchema {
    let current = scope;
    for (const segment of segments.slice(0, -1)) {
      const next = current.properties[segment];
      if (!next) {
        const child = newObject();
        current.properties[segment] = child;
        current = child;
      } else if (next.kind === 'object') {
        current = next;
      } else if (next.kind === 'array') {
        current = next.item;
      } else {
        if (next.kind !== 'boolean' && !this.weak.has(next)) {
          this.warn(`"${segment}" is used as both a value and an object; treated as an object.`);
        }
        const child: ObjectSchema = { kind: 'object', controls: next.controls, notes: next.notes, properties: {} };
        current.properties[segment] = child;
        current = child;
      }
    }
    return current;
  }

  private use(
    scope: ObjectSchema,
    path: string,
    use: Use,
    options: { control?: string | undefined; inputFormat?: string | undefined; note?: string | undefined },
  ): void {
    const segments = path.split('.');
    const parent = this.parentOf(scope, segments);
    const key = segments[segments.length - 1]!;
    let node = parent.properties[key];

    if (!node) {
      node = use === 'date'
        ? dateSchema(options.inputFormat)
        : { kind: use === 'unknown' ? 'string' : use, controls: [], notes: [] };
      if (use === 'unknown') this.weak.add(node);
      parent.properties[key] = node;
    } else if (node.kind === 'object' || node.kind === 'array') {
      if (use === 'string' || use === 'date') {
        this.warn(`"${path}" is used as both ${use} and ${node.kind}; kept as ${node.kind}.`);
      }
    } else {
      node = this.merge(parent, key, node, use, options.inputFormat, path);
    }

    if (options.control && !node.controls.includes(options.control)) node.controls.push(options.control);
    if (options.note && !node.notes.includes(options.note)) node.notes.push(options.note);
  }

  private merge(
    parent: ObjectSchema,
    key: string,
    existing: ScalarSchema,
    use: Use,
    inputFormat: string | undefined,
    path: string,
  ): ScalarSchema {
    if (use === 'unknown') return existing;
    const replace = (next: ScalarSchema): ScalarSchema => {
      const merged = { ...next, controls: existing.controls, notes: existing.notes };
      parent.properties[key] = merged;
      this.weak.delete(existing);
      return merged;
    };
    if (this.weak.has(existing)) {
      return replace(use === 'date'
        ? dateSchema(inputFormat)
        : { kind: use, controls: [], notes: [] });
    }
    if (existing.kind === use) {
      if (use === 'date' && inputFormat && !existing.inputFormat) {
        existing.inputFormat = inputFormat;
      } else if (use === 'date' && inputFormat && existing.inputFormat !== inputFormat) {
        this.warn(`"${path}" is read as a date in more than one input format (${existing.inputFormat}, ${inputFormat}); using ${existing.inputFormat}.`);
      }
      return existing;
    }
    this.warn(`"${path}" is used as both ${existing.kind} and ${use}; widened to string.`);
    return replace({ kind: 'string', controls: [], notes: [] });
  }
}

/** The data paths a schema describes, with array items as `name[].field`. */
export function schemaPaths(schema: ObjectSchema, prefix = ''): { path: string; kind: Schema['kind'] }[] {
  const out: { path: string; kind: Schema['kind'] }[] = [];
  for (const [key, child] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child.kind === 'object') out.push(...schemaPaths(child, path));
    else if (child.kind === 'array') {
      out.push({ path, kind: 'array' }, ...schemaPaths(child.item, `${path}[]`));
    } else out.push({ path, kind: child.kind });
  }
  return out;
}

export function summarise(schema: ObjectSchema): { fields: number; booleans: number; dates: number; repeats: number; strings: number } {
  const counts = { fields: 0, booleans: 0, dates: 0, repeats: 0, strings: 0 };
  for (const { kind } of schemaPaths(schema)) {
    if (kind === 'array') counts.repeats++;
    else {
      counts.fields++;
      if (kind === 'boolean') counts.booleans++;
      else if (kind === 'date') counts.dates++;
      else counts.strings++;
    }
  }
  return counts;
}
