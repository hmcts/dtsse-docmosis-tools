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
 * @property {InstructionRefs[]} refs For each instruction that reads data, the schema paths it reads, as `schemaPaths` writes them.
 *
 * @typedef {object} InstructionRefs
 * @property {string} text The instruction's text.
 * @property {string[]} paths
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

const SEGMENT = '[A-Za-z_]\\w*';
/** RegExp source for one step of a path: `.name` or `[n]`, with whitespace allowed around the dot and inside the index. */
export const STEP_SOURCE = `(?:\\s*\\.\\s*${SEGMENT}|\\s*\\[\\s*\\d+\\s*\\])`;

/**
 * RegExp source for one data name: `a.b`, `a[0].b`, or the same behind a `$root`, `$parent` or `$this` prefix.
 * Whitespace is allowed around a dot and inside an index. Every pattern that reads a name composes this one.
 */
export const NAME_SOURCE = `(?:\\$(?:root|parent|this)${STEP_SOURCE}+|${SEGMENT}${STEP_SOURCE}*)`;

/** RegExp source asserting that a `$root`, `$parent` or `$this` prefix is not the start of a longer `$` name such as `$thisIsMine`. */
const PREFIX_END = '(?![\\w$])';

const SCOPE_PREFIX_ONLY = /^\$(?:root|parent|this)$/;

const PREFIX = new RegExp(`^\\$(root|parent|this)${PREFIX_END}`);

const NAME = new RegExp(`^${NAME_SOURCE}$`);

/** @param {string} text @returns {string} */
const compact = (text) => text.replace(/\s+/g, '');

/**
 * Resolves a data reference to a schema path, in the form `schemaPaths` emits: dotted names, with `[]` for the
 * item of a repeat. `$root`, `$parent` and `$this` pick the base scope; a bare name is read from the current item.
 * An index segment `x[0]` reads an item of the array `x`, so it becomes `x[]`; `$this[0].x` is the item of the
 * current item, `items[][].x` inside `items`, which a schema cannot place.
 * dtsse-doc-render opens a scope for every repeat, named or not, and `$parent` is the enclosing one. At the top there is none, so `$parent` has no schema path.
 * @param {(string | null)[]} scopes the schema path of each scope, outermost first: `''` for the root, then one per enclosing repeat; `null` for a repeat over something no schema path names
 * @param {string} ref
 * @returns {string | null} null when the base scope has no schema path, including `$parent` outside any repeat, or the name is a `$` variable other than the three prefixes
 */
export function resolveRef(scopes, ref) {
  const text = compact(ref);
  const m = PREFIX.exec(text);
  if (!m && text.startsWith('$')) return null;
  const at = (i) => (i >= 0 && i < scopes.length ? scopes[i] : undefined);
  let base = at(scopes.length - 1);
  if (m?.[1] === 'root') base = at(0);
  else if (m?.[1] === 'parent') base = scopes.length < 2 ? null : at(scopes.length - 2);
  if (base === null) return null;
  base ??= '';
  const rest = (m ? text.slice(m[0].length) : text).replace(/\[\d+\]/g, '[]').replace(/^\./, '');
  if (!rest) return base;
  if (!base) return rest;
  return rest.startsWith('[') ? `${base}${rest}` : `${base}.${rest}`;
}

/**
 * Infers the data a template expects from its instruction tree.
 * @param {InstructionNode[]} tree
 * @param {{ refs?: boolean }} [options] `refs: false` skips building `refs`, which is returned empty
 * @returns {InferResult}
 */
export function inferSchema(tree, options = {}) {
  return new Inferrer(options.refs !== false).run(tree);
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

const BARE_CONDITION = new RegExp(`^(?:cs|cr|else)_\\{?\\s*!?\\s*(${NAME_SOURCE})\\s*\\}?$`);
const NAMED_REPEAT = new RegExp(`^(?:rs|rr)_\\s*(${NAME_SOURCE})$`);
const DATE_FORMAT = new RegExp(
  `\\bdateFormat\\(\\s*(${NAME_SOURCE})\\s*,\\s*(?:'[^']*'|"[^"]*")\\s*(?:,\\s*(?:'([^']*)'|"([^"]*)"))?\\s*\\)`,
  'g',
);
const BLANK_TEST = new RegExp(
  `\\bisBlank\\(\\s*(${NAME_SOURCE})\\s*\\)|(?<![\\w.])(${NAME_SOURCE})\\s*[!=]=\\s*null\\b|\\bnull\\s*[!=]=\\s*(${NAME_SOURCE})`,
  'g',
);

const REPEAT_TOKEN = new RegExp(`'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|(${NAME_SOURCE})|\\$[A-Za-z_]\\w*${STEP_SOURCE}*|[\\[\\](){}]`, 'g');

/**
 * The data name a token stands for, as dataRefs reads it: a method call keeps its target, so `parties.size`
 * before `(` is `parties`.
 * @param {string} name the token with whitespace removed
 * @param {string} after the text following the token
 * @returns {string | null} null when the token is a method on a scope prefix alone
 */
function callTarget(name, after) {
  if (!/^\s*\(/.test(after)) return name;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const target = name.slice(0, dot);
  return SCOPE_PREFIX_ONLY.test(target) ? null : target;
}

/**
 * Finds the list an unnamed repeat's expression starts from, and splits the other names by the scope they
 * are read in. In dtsse-doc-render only the bodies of .?[...] and .![...] are read per item; everything
 * else, method arguments included, is read in the enclosing scope. An expression that starts from anything
 * but a data name, such as a `$variable`, has no list the schema can place.
 * @param {string} text the repeat instruction
 * @param {string[]} refs the instruction's data names
 * @returns {{ target: string | undefined, inItem: string[], outer: string[] }}
 */
function splitRepeatRefs(text, refs) {
  const body = normaliseQuotes(text.replace(/^(?:rs|rr)_/, ''));
  /** @type {string[]} */
  const depth = [];
  const perItem = new Set();
  const enclosing = new Set();
  /** @type {string | null | undefined} */
  let target;
  for (const m of body.matchAll(REPEAT_TOKEN)) {
    if (m[1] !== undefined) {
      const name = callTarget(compact(m[1]), body.slice(m.index + m[0].length));
      if (target === undefined) target = name;
      if (name !== null) (depth.includes('[') ? perItem : enclosing).add(name);
      continue;
    }
    if (m[0] === '{' || m[0] === '(') {
      depth.push(m[0]);
      continue;
    }
    if (target === undefined) target = null;
    if (m[0] === '[') depth.push(m[0]);
    else if ('])}'.includes(m[0])) depth.pop();
  }
  const rest = refs.filter((ref) => ref !== target);
  return {
    target: target && refs.includes(target) ? target : undefined,
    inItem: rest.filter((ref) => perItem.has(ref)),
    outer: rest.filter((ref) => enclosing.has(ref) || !perItem.has(ref)),
  };
}

/** @typedef {{ parent: ObjectSchema, key: string, path: string, trailing: boolean }} Place */

/** @typedef {{ text: string, names: Set<string> }} Unplaced What a repeat with no schema path holds: its instruction and the names read inside it. */

class Inferrer {
  /** @param {boolean} wantRefs */
  constructor(wantRefs) {
    this.wantRefs = wantRefs;
  }

  /** @type {string[]} */
  warnings = [];
  /** @type {InstructionRefs[]} */
  refs = [];
  /** How many warnings have been raised, repeats included, so a caller can tell whether a step warned. */
  warned = 0;
  /**
   * Scalars seen only in blank/null tests, so any stronger later use can replace them.
   * @type {Set<Schema>}
   */
  weak = new Set();
  /** @type {ObjectSchema} */
  root = newObject();
  /**
   * The schema path of each scope in force, outermost first (see resolveRef).
   * @type {(string | null)[]}
   */
  scopes = [''];
  /**
   * Parallel to `scopes`: for a scope with no schema path, what is read inside it.
   * @type {(Unplaced | null)[]}
   */
  unplacedScopes = [null];
  /** Schema paths the instruction being visited has read. @type {Set<string>} */
  seen = new Set();

  /** @param {InstructionNode[]} tree @returns {InferResult} */
  run(tree) {
    this.walk(tree);
    if (!this.wantRefs) return { root: this.root, warnings: this.warnings, refs: [] };
    const known = new Set(nodePaths(this.root));
    const refs = this.refs
      .map(({ text, paths }) => ({ text, paths: paths.filter((path) => known.has(path)) }))
      .filter((entry) => entry.paths.length > 0);
    return { root: this.root, warnings: this.warnings, refs };
  }

  /** @param {string} message */
  warn(message) {
    this.warned++;
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** @param {InstructionNode[]} nodes */
  walk(nodes) {
    for (const node of nodes) {
      if (node.type === 'comment') continue;
      this.seen = new Set();
      if (node.type === 'repeat') {
        const { scope, unplaced } = this.repeat(node);
        this.enter(scope, unplaced);
        this.walk(node.children);
        this.leave();
        this.warnUnplaced(unplaced);
        continue;
      }
      if (node.type === 'field') this.expression(node, node.dataRefs, undefined);
      else if (node.type === 'condition' || node.type === 'else') this.condition(node);
      this.record(node);
      this.walk(node.children);
    }
  }

  /** @param {string | null} scope @param {Unplaced | null} unplaced */
  enter(scope, unplaced) {
    this.scopes.push(scope);
    this.unplacedScopes.push(unplaced);
  }

  leave() {
    this.scopes.pop();
    this.unplacedScopes.pop();
  }

  /** @param {Unplaced | null} unplaced */
  warnUnplaced(unplaced) {
    if (unplaced && unplaced.names.size > 0) {
      this.warn(`"${unplaced.text}" repeats over something the schema can't place, so the names inside it (${[...unplaced.names].join(', ')}) are not in the form`);
    }
  }

  /** @param {InstructionNode} node */
  record(node) {
    if (!this.wantRefs) return;
    if (this.seen.size > 0) this.refs.push({ text: node.text, paths: [...this.seen] });
  }

  /**
   * Resolves a name in the scopes in force; $parent outside any repeat reads nothing.
   * @param {string} ref
   * @returns {string | null}
   */
  resolve(ref) {
    const text = compact(ref);
    const prefix = PREFIX.exec(text)?.[1];
    if (prefix === 'parent' && this.scopes.length < 2) {
      this.warn(`\`${text}\` is outside any repeat, so it is always empty.`);
      return null;
    }
    const last = this.scopes.length - 1;
    const index = prefix === 'root' ? 0 : prefix === 'parent' ? last - 1 : last;
    if (this.scopes[index] === null) {
      this.unplacedScopes[index]?.names.add(text);
      return null;
    }
    return resolveRef(this.scopes, ref);
  }

  /**
   * Finds the property a path names, creating what is missing on the way.
   * @param {string | null} path a resolved schema path
   * @param {string} ref the name as written, for warnings
   * @returns {Place | null} null when the path has no place in a schema
   */
  locate(path, ref) {
    if (path === null) return null;
    const tokens = path.match(/[^.[\]]+|\[\]/g) ?? [];
    const trailing = tokens[tokens.length - 1] === '[]';
    if (trailing) tokens.pop();
    if (tokens.length === 0) return this.unplaced(ref);
    let current = this.root;
    let canonical = '';
    let i = 0;
    const join = (name) => (canonical ? `${canonical}.${name}` : name);
    for (; i < tokens.length - 1; i++) {
      const name = tokens[i];
      if (name === '[]') return this.unplaced(ref);
      const at = join(name);
      const next = current.properties[name];
      const indexed = tokens[i + 1] === '[]';
      if (indexed && (!next || (next.kind !== 'object' && next.kind !== 'array'))) {
        this.indexed(current, name, at);
        current = /** @type {ArraySchema} */ (current.properties[name]).item;
        canonical = `${at}[]`;
        i++;
        continue;
      }
      if (!next) {
        const child = newObject();
        current.properties[name] = child;
        current = child;
        canonical = at;
      } else if (next.kind === 'object') {
        current = next;
        canonical = at;
      } else if (next.kind === 'array') {
        current = next.item;
        canonical = `${at}[]`;
      } else {
        if (next.kind !== 'boolean' && !this.weak.has(next)) {
          this.warn(`"${at}" is used as both a value and an object; treated as an object.`);
        }
        /** @type {ObjectSchema} */
        const child = { kind: 'object', controls: next.controls, notes: withoutBlankNote(next.notes), properties: {} };
        this.weak.delete(next);
        current.properties[name] = child;
        current = child;
        canonical = at;
      }
      if (indexed && next?.kind === 'array') i++;
    }
    const key = tokens[tokens.length - 1];
    if (key === '[]') return this.unplaced(ref);
    return { parent: current, key, path: join(key), trailing };
  }

  /** @param {string} ref @returns {null} */
  unplaced(ref) {
    this.warn(`"${compact(ref)}" indexes something that is not a list; ignored.`);
    return null;
  }

  /** @param {InstructionNode} node */
  condition(node) {
    const bare = BARE_CONDITION.exec(node.text);
    if (bare) {
      this.use(bare[1], 'boolean', { control: node.text });
      return;
    }
    this.expression(node, node.dataRefs, node.text);
  }

  /**
   * Handles a repeat and returns the schema path of the scope it opens, or null with a record of what is
   * read inside when the schema cannot place the list.
   * @param {InstructionNode} node
   * @returns {{ scope: string | null, unplaced: Unplaced | null }}
   */
  repeat(node) {
    const named = NAMED_REPEAT.exec(node.text);
    const split = named ? undefined : splitRepeatRefs(node.text, node.dataRefs);
    const before = this.warned;
    const array = this.array(named ? named[1] : split?.target, node.text);
    const scope = array === null ? null : `${array}[]`;
    const unplaced = scope === null && this.warned === before ? { text: node.text, names: new Set() } : null;
    if (split) {
      this.expression(node, split.outer, undefined);
      this.enter(scope, unplaced);
      this.expression(node, split.inItem, undefined);
      this.leave();
    }
    this.record(node);
    return { scope, unplaced };
  }

  /**
   * Makes the name a repeat target: an array in the schema.
   * @param {string | undefined} ref
   * @param {string} text the repeat instruction
   * @returns {string | null} the array's schema path
   */
  array(ref, text) {
    if (ref === undefined) return null;
    const place = this.locate(this.resolve(ref), ref);
    if (!place) return null;
    const { parent, key, path } = place;
    const existing = parent.properties[key];
    this.seen.add(path);
    if (place.trailing) {
      this.indexed(parent, key, path);
      this.warn(`"${text}" repeats over an item of the list "${path}", and the schema doesn't model a list inside a list.`);
      return null;
    }
    if (!existing) {
      /** @type {ArraySchema} */
      const array = { kind: 'array', controls: [], notes: [], item: newObject() };
      parent.properties[key] = array;
    } else if (existing.kind === 'object') {
      this.warn(`"${path}" is used as both an object and a repeat; its repeat rows are ignored.`);
      return null;
    } else if (existing.kind !== 'array') {
      this.toArray(parent, key, existing, path);
    }
    return path;
  }

  /** @param {InstructionNode} node @param {string[]} refs @param {string | undefined} control */
  expression(node, refs, control) {
    const body = normaliseQuotes(node.text.replace(/^(?:cs|cr|rs|rr|else)_/, ''));
    /** @type {Map<string, string | undefined>} */
    const dates = new Map();
    for (const m of body.matchAll(DATE_FORMAT)) dates.set(compact(m[1]), m[2] ?? m[3]);
    const blankTested = new Set();
    for (const m of body.matchAll(BLANK_TEST)) blankTested.add(compact(m[1] ?? m[2] ?? m[3]));
    for (const ref of refs) {
      const options = { control };
      if (dates.has(ref)) this.use(ref, 'date', { ...options, inputFormat: dates.get(ref) });
      else if (blankTested.has(ref)) this.use(ref, 'unknown', { ...options, note: BLANK_NOTE });
      else this.use(ref, 'string', options);
    }
  }

  /**
   * @param {string} ref
   * @param {Use} use
   * @param {{ control?: string | undefined, inputFormat?: string | undefined, note?: string | undefined }} options
   */
  use(ref, use, options) {
    const place = this.locate(this.resolve(ref), ref);
    if (!place) return;
    const { parent, key, path } = place;
    this.seen.add(path);
    if (place.trailing) {
      this.indexed(parent, key, path);
      this.addControl(parent.properties[key], options.control);
      return;
    }
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

    this.addControl(node, options.control);
    if (options.note && this.weak.has(node) && !node.notes.includes(options.note)) node.notes.push(options.note);
  }

  /** @param {Schema | undefined} node @param {string | undefined} control */
  addControl(node, control) {
    if (node && control && !node.controls.includes(control)) node.controls.push(control);
  }

  /**
   * A name ending in an index, such as `items[0]`, reads an item of the list `items`.
   * @param {ObjectSchema} parent @param {string} key @param {string} path
   */
  indexed(parent, key, path) {
    const existing = parent.properties[key];
    if (!existing) {
      parent.properties[key] = { kind: 'array', controls: [], notes: [], item: newObject() };
    } else if (existing.kind !== 'array' && existing.kind !== 'object') {
      this.toArray(parent, key, existing, path);
    }
  }

  /**
   * Replaces a scalar with an array. Boolean and blank-tested scalars are not worth a warning.
   * @param {ObjectSchema} parent @param {string} key @param {ScalarSchema} existing @param {string} path
   */
  toArray(parent, key, existing, path) {
    if (existing.kind !== 'boolean' && !this.weak.has(existing)) {
      this.warn(`"${path}" is used as both ${existing.kind} and a repeat; treated as a repeat.`);
    }
    this.weak.delete(existing);
    parent.properties[key] = { kind: 'array', controls: existing.controls, notes: withoutBlankNote(existing.notes), item: newObject() };
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
 * Every path a schema names, objects and arrays as well as leaves, in the form `schemaPaths` writes them.
 * @param {ObjectSchema} schema
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function nodePaths(schema, prefix = '') {
  return Object.entries(schema.properties).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child.kind === 'object') return [path, ...nodePaths(child, path)];
    if (child.kind === 'array') return [path, ...nodePaths(child.item, `${path}[]`)];
    return [path];
  });
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
