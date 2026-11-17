// Infers the data a Docmosis template expects from its instruction tree (instructionTree in
// docx.mjs): which names are text, booleans, dates or repeats, and which blocks read them.
//
// Pure, with no Node built-ins, so an editor or browser bundle can import it. The JSON shape
// of inferSchema's result is a contract other tools consume; see "Schema JSON" in the README.

/**
 * @typedef {'string' | 'boolean' | 'date'} ScalarKind
 *
 * @typedef {object} ScalarSchema
 * @property {ScalarKind} kind
 * @property {string[]} controls Template blocks (for example `cs_isEngland`) whose condition reads this value.
 * @property {string[]} notes
 * @property {string} [inputFormat] For dates: the format the template parses the stored value with, when it names one.
 *
 * @typedef {object} ObjectSchema
 * @property {'object'} kind
 * @property {string[]} controls
 * @property {string[]} notes
 * @property {Record<string, Schema>} properties
 *
 * @typedef {object} ArraySchema
 * @property {'array'} kind
 * @property {string[]} controls
 * @property {string[]} notes
 * @property {ObjectSchema} item
 *
 * @typedef {ScalarSchema | ObjectSchema | ArraySchema} Schema
 *
 * @typedef {object} InferResult
 * @property {ObjectSchema} root
 * @property {string[]} warnings
 *
 * @typedef {object} InstructionNode One node of instructionTree's output.
 * @property {'field' | 'condition' | 'repeat' | 'else' | 'comment'} type
 * @property {string} text
 * @property {string[]} dataRefs
 * @property {InstructionNode[]} children What a block (condition, repeat or else branch) encloses.
 * @property {boolean} [row] True for row-level blocks (cr_ / rr_).
 * @property {{ part: string, paragraph: number, label?: string }} [location]
 */

/**
 * Rewrites typographic quotes, which Word inserts and Docmosis accepts, as straight ones.
 * @param {string} text
 * @returns {string}
 */
export function normaliseQuotes(text) {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

const BLANK_NOTE = 'The template only tests whether this is blank or null.';

/** @param {string[]} notes @returns {string[]} */
const withoutBlankNote = (notes) => notes.filter((note) => note !== BLANK_NOTE);

/** @typedef {'string' | 'boolean' | 'date' | 'unknown'} Use */

/**
 * Resolves a data reference to a schema path, applying a `$root.`, `$parent.` or `$this.` prefix the way inference does.
 * @param {string[]} scopes the schema path of each scope, outermost first: `''` for the root, then one per enclosing repeat
 * @param {string} ref
 * @returns {string}
 */
export function resolveScopedPath(scopes, ref) {
  const current = scopes[scopes.length - 1] ?? '';
  const m = /^\$(root|parent|this)\s*(?:\.|(?=\[))(.*)$/s.exec(ref);
  let base = current;
  if (m?.[1] === 'root') base = scopes[0] ?? '';
  else if (m?.[1] === 'parent') base = scopes[scopes.length - 2] ?? scopes[0] ?? '';
  const rest = m ? m[2].replace(/\s+/g, '') : ref;
  if (!base) return rest;
  return rest.startsWith('[') ? `${base}${rest}` : `${base}.${rest}`;
}

/**
 * Infers the data a template expects from its instruction tree.
 * @param {InstructionNode[]} tree
 * @returns {InferResult}
 */
export function inferSchema(tree) {
  return new Inferrer().run(tree);
}

/** @param {string | undefined} inputFormat @returns {ScalarSchema} */
const dateSchema = (inputFormat) => ({
  kind: 'date',
  controls: [],
  notes: [],
  ...(inputFormat ? { inputFormat } : {}),
});

/** @returns {ObjectSchema} */
const newObject = () => ({ kind: 'object', controls: [], notes: [], properties: {} });

class Inferrer {
  /** @type {string[]} */
  warnings = [];
  /**
   * Scalars seen only in blank/null tests, so any stronger later use can replace them.
   * @type {Set<Schema>}
   */
  weak = new Set();
  /**
   * The objects in scope, outermost first: the root, then the item of each enclosing repeat.
   * @type {ObjectSchema[]}
   */
  chain = [];

  /** @param {InstructionNode[]} tree @returns {InferResult} */
  run(tree) {
    const root = newObject();
    this.chain = [root];
    this.walk(tree, root);
    return { root, warnings: this.warnings };
  }

  /** @param {string} message */
  warn(message) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** @param {InstructionNode[]} nodes @param {ObjectSchema} scope */
  walk(nodes, scope) {
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
          this.chain.push(this.repeat(node, scope));
          this.walk(node.children, this.chain[this.chain.length - 1]);
          this.chain.pop();
          break;
        case 'else':
          this.walk(node.children, scope);
          break;
      }
    }
  }

  /**
   * Applies a `$root.`, `$parent.` or `$this.` prefix to a name, returning the scope it is read from.
   * @param {ObjectSchema} scope
   * @param {string} path
   * @returns {{ scope: ObjectSchema, segments: string[] }}
   */
  resolve(scope, path) {
    const m = /^\$(root|parent|this)\s*(?:\.|(?=\[))(.*)$/s.exec(path);
    if (!m) return { scope, segments: path.split('.') };
    const at = this.chain.lastIndexOf(scope);
    const base = m[1] === 'root' ? this.chain[0] : m[1] === 'this' ? scope : (this.chain[at - 1] ?? this.chain[0]);
    return { scope: base, segments: m[2].replace(/\s+/g, '').split('.') };
  }

  /** @param {InstructionNode} node @param {ObjectSchema} scope */
  condition(node, scope) {
    const bare = /^(?:cs|cr)_\{?\s*!?\s*(\$(?:root|parent|this)\.[\w.]+|[A-Za-z_][\w.]*)\s*\}?$/.exec(node.text);
    if (bare) {
      this.use(scope, bare[1], 'boolean', { control: node.text });
      return;
    }
    this.expression(node, scope, node.text);
  }

  /** @param {InstructionNode} node @param {ObjectSchema} scope @returns {ObjectSchema} */
  repeat(node, scope) {
    const named = /^(?:rs|rr)_(\$(?:root|parent|this)\.[\w.]+|[A-Za-z_][\w.]*)$/.exec(node.text);
    if (!named) {
      this.expression(node, scope, undefined);
      return scope;
    }
    const target = this.resolve(scope, named[1]);
    const segments = target.segments;
    const parent = this.parentOf(target.scope, segments);
    const key = segments[segments.length - 1];
    const existing = parent.properties[key];
    if (!existing) {
      /** @type {ArraySchema} */
      const array = { kind: 'array', controls: [], notes: [], item: newObject() };
      parent.properties[key] = array;
      return array.item;
    }
    if (existing.kind === 'array') return existing.item;
    if (existing.kind === 'object') {
      this.warn(`"${named[1]}" is used as both an object and a repeat; its repeat rows are ignored.`);
      return newObject();
    }
    /** @type {ArraySchema} */
    const array = { kind: 'array', controls: existing.controls, notes: withoutBlankNote(existing.notes), item: newObject() };
    if (existing.kind !== 'boolean' && !this.weak.has(existing)) {
      this.warn(`"${named[1]}" is used as both ${existing.kind} and a repeat; treated as a repeat.`);
    }
    this.weak.delete(existing);
    parent.properties[key] = array;
    return array.item;
  }

  /** @param {InstructionNode} node @param {ObjectSchema} scope @param {string | undefined} control */
  expression(node, scope, control) {
    const body = normaliseQuotes(node.text.replace(/^(?:cs|cr|rs|rr)_/, ''));
    /** @type {Map<string, string | undefined>} */
    const dates = new Map();
    for (const m of body.matchAll(/\bdateFormat\(\s*(\$(?:root|parent|this)\.[\w.]+|[A-Za-z_][\w.]*)\s*,\s*(?:'[^']*'|"[^"]*")\s*(?:,\s*(?:'([^']*)'|"([^"]*)"))?\s*\)/g)) {
      dates.set(m[1], m[2] ?? m[3]);
    }
    const blankTested = new Set();
    for (const m of body.matchAll(/\bisBlank\(\s*(\$(?:root|parent|this)\.[\w.]+|[A-Za-z_][\w.]*)\s*\)|(?<![\w.])(\$(?:root|parent|this)\.[\w.]+|[A-Za-z_][\w.]*)\s*[!=]=\s*null\b|\bnull\s*[!=]=\s*(\$(?:root|parent|this)\.[\w.]+|[A-Za-z_][\w.]*)/g)) {
      blankTested.add(m[1] ?? m[2] ?? m[3]);
    }
    for (const ref of node.dataRefs) {
      const options = { control };
      if (dates.has(ref)) this.use(scope, ref, 'date', { ...options, inputFormat: dates.get(ref) });
      else if (blankTested.has(ref)) this.use(scope, ref, 'unknown', { ...options, note: BLANK_NOTE });
      else this.use(scope, ref, 'string', options);
    }
  }

  /** @param {ObjectSchema} scope @param {string[]} segments @returns {ObjectSchema} */
  parentOf(scope, segments) {
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
        /** @type {ObjectSchema} */
        const child = { kind: 'object', controls: next.controls, notes: withoutBlankNote(next.notes), properties: {} };
        this.weak.delete(next);
        current.properties[segment] = child;
        current = child;
      }
    }
    return current;
  }

  /**
   * @param {ObjectSchema} scope
   * @param {string} path
   * @param {Use} use
   * @param {{ control?: string | undefined, inputFormat?: string | undefined, note?: string | undefined }} options
   */
  use(scope, path, use, options) {
    const target = this.resolve(scope, path);
    const segments = target.segments;
    const parent = this.parentOf(target.scope, segments);
    const key = segments[segments.length - 1];
    /** @type {Schema | undefined} */
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
    if (options.note && this.weak.has(node) && !node.notes.includes(options.note)) node.notes.push(options.note);
  }

  /**
   * @param {ObjectSchema} parent
   * @param {string} key
   * @param {ScalarSchema} existing
   * @param {Use} use
   * @param {string | undefined} inputFormat
   * @param {string} path
   * @returns {ScalarSchema}
   */
  merge(parent, key, existing, use, inputFormat, path) {
    if (use === 'unknown') return existing;
    /** @param {ScalarSchema} next @returns {ScalarSchema} */
    const replace = (next) => {
      const merged = { ...next, controls: existing.controls, notes: withoutBlankNote(existing.notes) };
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

/**
 * The data paths a schema describes, with array items as `name[].field`.
 * @param {ObjectSchema} schema
 * @param {string} [prefix]
 * @returns {{ path: string, kind: Schema['kind'] }[]}
 */
export function schemaPaths(schema, prefix = '') {
  /** @type {{ path: string, kind: Schema['kind'] }[]} */
  const out = [];
  for (const [key, child] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child.kind === 'object') out.push(...schemaPaths(child, path));
    else if (child.kind === 'array') {
      out.push({ path, kind: 'array' }, ...schemaPaths(child.item, `${path}[]`));
    } else out.push({ path, kind: child.kind });
  }
  return out;
}

/**
 * @param {ObjectSchema} schema
 * @returns {{ fields: number, booleans: number, dates: number, repeats: number, strings: number }}
 */
export function summarise(schema) {
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
