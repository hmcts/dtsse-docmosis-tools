#!/usr/bin/env node
// Reads, checks, compares, unpacks and packs Docmosis .docx templates.
//
// As a module, every function returns data and throws DocxError; nothing prints or exits.
// A template argument is a .docx path, a folder made by unpack(), or the object
// readTemplate() returns: { path, parts: [{ name, xml }] }. An editor can build that object
// from an unsaved buffer.
//
// As a CLI: node docx.mjs <text|fields|tree|check|diff|unpack|pack> ...  (--help for detail)
//
// Zip reading and writing is in-process, with node:zlib.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const usage = `usage: docx.mjs <command> [args]

  text <template>               paragraph text, one paragraph per line; table rows on one
                                line with cells separated by " | "
  fields <template>             Docmosis instructions in document order, nested by block
  tree <template>               the instruction tree as JSON, with each instruction's data
                                references
  check <template>              block, delimiter and split-run problems; exits 1 on errors
  diff <old> <new>              instructions added, removed and moved between templates
  unpack <file.docx> <dir>      extract for editing; document, header and footer XML get a
                                line break before each table, row, cell and paragraph, and
                                <dir>/.docx-entries and .docx-original/ record the original
  pack <dir> <file.docx>        zip a folder back into a .docx, undoing unpack's line breaks;
                                unchanged parts get their original bytes back

<template> is a .docx file or a folder made by unpack.`;

const CONTENT_PART = /^word\/(document|header\d*|footer\d*)\.xml$/;
const BREAK_BEFORE = /(?=<(?:w:tbl|\/w:tbl|w:tr|w:tc|w:p|w:sectPr)[\s>/])/g;
const ORDER_FILE = '.docx-entries';
const ORIGINAL_DIR = '.docx-original';
const UNBREAK = /\r?\n[ \t]*(?=<(?:w:tbl|\/w:tbl|w:tr|w:tc|w:p|w:sectPr)[\s>/])/g;

export class DocxError extends Error {
    constructor(message, { exitCode = 2, details } = {}) {
        super(message);
        this.name = 'DocxError';
        this.exitCode = exitCode;
        if (details) this.details = details;
    }
}

// ---------- zip ----------

// Encrypted and zip64 archives aren't .docx files Word writes, so they aren't supported.

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// DOS dates and times are local time, as zip and unzip treat them.
function toDosTime(date) {
    const d = date.getFullYear() < 1980 ? new Date(1980, 0, 1) : date;
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

function fromDosTime(time, date) {
    return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

// The archive's file entries in central-directory order, each with read() for its bytes.
function zipOpen(file) {
    const notZip = () => new DocxError(`${file} isn't a readable zip, so it isn't a .docx`);
    let buf;
    try {
        buf = fs.readFileSync(file);
    } catch {
        throw notZip();
    }
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw notZip();
    const count = buf.readUInt16LE(eocd + 10);
    let at = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || at === 0xffffffff) throw new DocxError(`${file} is a zip64 archive, which a .docx isn't`);
    const entries = [];
    for (let k = 0; k < count; k++) {
        if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw notZip();
        const flags = buf.readUInt16LE(at + 8);
        const method = buf.readUInt16LE(at + 10);
        const mtime = fromDosTime(buf.readUInt16LE(at + 12), buf.readUInt16LE(at + 14));
        const compressed = buf.readUInt32LE(at + 20);
        const size = buf.readUInt32LE(at + 24);
        const nameLen = buf.readUInt16LE(at + 28);
        const local = buf.readUInt32LE(at + 42);
        const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLen);
        at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
        if (name.endsWith('/')) continue;
        const read = () => {
            if (flags & 1) throw new DocxError(`${file}: ${name} is encrypted`);
            if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw notZip();
            const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            const raw = buf.subarray(start, start + compressed);
            let data;
            if (method === 0) data = raw;
            else if (method === 8) {
                try {
                    data = zlib.inflateRawSync(raw);
                } catch {
                    throw new DocxError(`${file}: ${name} is corrupt`);
                }
            } else throw new DocxError(`${file}: ${name} uses zip compression method ${method}, which isn't supported`);
            if (data.length !== size) throw new DocxError(`${file}: ${name} is corrupt`);
            return data;
        };
        entries.push({ name, mtime, read });
    }
    return entries;
}

// files: [{ name, data, mtime }], zipped in that order. An entry deflate doesn't shrink is
// stored, as zip does.
function zipBuild(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = Buffer.from(f.name, 'utf8');
        const deflated = zlib.deflateRawSync(f.data);
        const stored = deflated.length >= f.data.length;
        const body = stored ? f.data : deflated;
        const { time, date } = toDosTime(f.mtime);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(/[^\x20-\x7e]/.test(f.name) ? 0x800 : 0, 6);
        local.writeUInt16LE(stored ? 0 : 8, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc32(f.data), 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(f.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        local.copy(entry, 6, 4, 30);
        entry.writeUInt32LE(offset, 42);
        chunks.push(local, name, body);
        central.push(entry, name);
        offset += local.length + name.length + body.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.reduce((n, b) => n + b.length, 0), 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, ...central, end]);
}

// ---------- template access ----------

function walkDir(dir, prefix = '') {
    const out = [];
    for (const e of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
        if (!prefix && e.name.startsWith('.docx-')) continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...walkDir(dir, rel));
        else out.push(rel);
    }
    return out;
}

const partOrder = (n) => (n === 'word/document.xml' ? 0 : n.includes('header') ? 1 : 2);

// The document, header and footer parts of a .docx file or unpacked folder, document first.
export function readTemplate(p) {
    if (!fs.existsSync(p)) throw new DocxError(`no such file: ${p}`);
    const isDir = fs.statSync(p).isDirectory();
    const zipped = isDir ? null : new Map(zipOpen(p).map((e) => [e.name, e]));
    const names = isDir ? walkDir(p) : [...zipped.keys()];
    if (!names.includes('word/document.xml')) throw new DocxError(`${p} has no word/document.xml, so it isn't a .docx`);
    const parts = names
        .filter((n) => CONTENT_PART.test(n))
        .sort((a, b) => partOrder(a) - partOrder(b) || a.localeCompare(b, 'en', { numeric: true }));
    const read = (n) => (isDir ? fs.readFileSync(path.join(p, n), 'utf8') : zipped.get(n).read().toString('utf8'));
    return { path: p, parts: parts.map((name) => ({ name, xml: read(name) })) };
}

function partsOf(template) {
    const t = typeof template === 'string' ? readTemplate(template) : template;
    if (!t || !Array.isArray(t.parts)) throw new DocxError('expected a template path or { parts: [{ name, xml }] }');
    return t.parts;
}

// ---------- XML model ----------

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENTITIES[e] ?? m;
    });
}

// rPr differences that don't change how text looks or how Docmosis reads it. An rPr left
// with no children is the same as none.
function normaliseRpr(rpr) {
    const r = rpr.replace(/<w:(lang|noProof|proofErr)\b[^>]*\/>/g, '').replace(/\s+w:rsid\w*="[^"]*"/g, '');
    return /^<w:rPr\b[^>]*>\s*<\/w:rPr>$/.test(r) ? '' : r;
}

// Builds the body as a tree of tables, rows, cells and paragraphs. Each paragraph keeps
// its text, the run each character came from, and where non-run elements interrupt it.
function parsePart(xml) {
    const tokenRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    const root = { kind: 'body', children: [] };
    const containers = [root];
    const tables = [];
    const paras = [];
    let pCount = 0;
    let tCount = 0;
    let para = null;
    let run = null;
    let inText = false;
    let skipDepth = 0;
    let rprStart = -1;
    let tabsDepth = 0;
    // A paragraph can sit inside a run (a text box in a w:drawing), so opening one saves the
    // outer paragraph and run, and closing it restores them.
    const paraStack = [];

    const top = () => containers[containers.length - 1];
    const tablePath = () =>
        tables.map((t) => ({ table: t.n, row: t.rowCount, cell: t.cellCount }));

    let m;
    while ((m = tokenRe.exec(xml))) {
        const [tok, close, name, , selfClose, text] = m;
        if (text !== undefined) {
            if (skipDepth || !para) continue;
            if (inText && run) {
                para.addText(decode(text), run, m.index);
            }
            continue;
        }
        if (!name) continue;

        if (skipDepth) {
            if (name === 'mc:Fallback') skipDepth += close ? -1 : selfClose ? 0 : 1;
            continue;
        }
        if (name === 'mc:Fallback' && !close && !selfClose) {
            skipDepth = 1;
            continue;
        }

        if (close) {
            switch (name) {
                case 'w:tbl': {
                    tables.pop();
                    containers.pop();
                    break;
                }
                case 'w:tr':
                case 'w:tc':
                    containers.pop();
                    break;
                case 'w:p': {
                    const outer = paraStack.pop();
                    para = outer?.para ?? null;
                    run = outer?.run ?? null;
                    inText = outer?.inText ?? false;
                    containers.pop();
                    break;
                }
                case 'w:tabs':
                    tabsDepth = Math.max(0, tabsDepth - 1);
                    break;
                case 'w:r':
                    run = null;
                    break;
                case 'w:t':
                    inText = false;
                    break;
                case 'w:rPr':
                    if (run && rprStart >= 0) {
                        run.rpr = normaliseRpr(xml.slice(rprStart, m.index + tok.length));
                        rprStart = -1;
                    }
                    break;
                default:
                    break;
            }
            continue;
        }

        switch (name) {
            case 'w:tbl': {
                if (selfClose) break;
                const t = { kind: 'table', n: ++tCount, rows: [], rowCount: 0, cellCount: 0 };
                top().children.push(t);
                tables.push(t);
                containers.push(t);
                break;
            }
            case 'w:tr': {
                if (selfClose) break;
                const t = tables[tables.length - 1];
                t.rowCount += 1;
                t.cellCount = 0;
                const r = { kind: 'row', n: t.rowCount, cells: [] };
                t.rows.push(r);
                containers.push(r);
                break;
            }
            case 'w:tc': {
                if (selfClose) break;
                const t = tables[tables.length - 1];
                t.cellCount += 1;
                const c = { kind: 'cell', n: t.cellCount, children: [] };
                top().cells.push(c);
                containers.push(c);
                break;
            }
            case 'w:p': {
                const p = newParagraph(++pCount, tablePath());
                top().children.push(p);
                paras.push(p);
                if (selfClose) break;
                paraStack.push({ para, run, inText });
                para = p;
                run = null;
                inText = false;
                containers.push(p);
                break;
            }
            case 'w:r':
                if (!para || selfClose) break;
                run = { n: para.runCount++, rpr: '' };
                break;
            case 'w:rPr':
                if (run && !selfClose) rprStart = m.index;
                break;
            case 'w:t':
                if (!selfClose) inText = true;
                break;
            case 'w:tabs':
                if (!selfClose) tabsDepth += 1;
                break;
            case 'w:tab':
                if (run && para && !tabsDepth) para.addText('\t', run, m.index);
                break;
            case 'w:br':
            case 'w:cr':
                if (run && para) para.addText('\n', run, m.index);
                break;
            case 'w:noBreakHyphen':
                if (run && para) para.addText('-', run, m.index);
                break;
            case 'w:bookmarkStart':
            case 'w:bookmarkEnd':
            case 'w:proofErr':
            case 'w:fldChar':
            case 'w:fldSimple':
            case 'w:hyperlink':
            case 'w:ins':
            case 'w:del':
            case 'w:smartTag':
            case 'w:sdt':
                if (para) para.markers.push({ at: para.text.length, what: name.slice(2) });
                break;
            default:
                break;
        }
    }
    return { root, paras };
}

function newParagraph(n, where) {
    return {
        kind: 'para',
        n,
        where,
        text: '',
        chars: [],
        offsets: [],
        markers: [],
        runCount: 0,
        children: [],
        addText(s, run, at) {
            this.text += s;
            for (let i = 0; i < s.length; i++) {
                this.chars.push(run);
                this.offsets.push(at);
            }
        },
    };
}

function locate(p) {
    const cells = p.where.map((w) => `t${w.table}.r${w.row}.c${w.cell}`).join('>');
    return cells ? `p${p.n} ${cells}` : `p${p.n}`;
}

// ---------- Docmosis instructions ----------

// Kinds: cs (conditional section), cr (conditional row), rs (repeating section),
// rr (repeating row), es / er (section / row end), else, field.
function classify(body) {
    const b = body.trim();
    const kw = /^(cs|cr|rs|rr|es|er)_(.*)$/s.exec(b);
    if (kw) return { kind: kw[1], name: kw[2] };
    if (/^else(_.*)?$/s.test(b)) return { kind: 'else', name: b.slice(5) };
    if (b.startsWith('/*')) return { kind: 'comment' };
    if (b.startsWith('$')) return { kind: 'field', sub: 'variable' };
    if (b.startsWith('{')) return { kind: 'field', sub: 'expression' };
    const pre = /^(op|link|ref|html|image|img|bookmark|md):/.exec(b);
    if (pre) return { kind: 'field', sub: pre[1] };
    return { kind: 'field', sub: '' };
}

const ELSE_MARK = '\u0001';
const STARTS = new Set(['cs', 'cr', 'rs', 'rr']);
const ENDS_FOR = { es: new Set(['cs', 'rs']), er: new Set(['cr', 'rr']) };
const END_FOR = { cs: 'es_', rs: 'es_', cr: 'er_', rr: 'er_' };

function instructionsOf(part) {
    const { paras } = parsePart(part.xml);
    const found = [];
    const problems = [];
    for (const p of paras) {
        const t = p.text;
        let i = t.indexOf('<<');
        while (i >= 0) {
            const close = t.startsWith('<</*', i) && t.indexOf('*/>>', i) >= 0 ? t.indexOf('*/>>', i) + 2 : t.indexOf('>>', i + 2);
            const next = t.indexOf('<<', i + 2);
            if (close < 0 || (next >= 0 && next < close && !t.startsWith('<</*', i))) {
                problems.push({ level: 'error', part: part.name, loc: locate(p), msg: `"<<" with no closing ">>" in the same paragraph: ${JSON.stringify(t.slice(i, i + 40))}` });
                i = next;
                continue;
            }
            const end = close + 2;
            const body = t.slice(i + 2, close);
            const runs = new Set(p.chars.slice(i, end).map((r) => r.n));
            const rprs = new Set(p.chars.slice(i, end).map((r) => r.rpr));
            const interrupts = [...new Set(p.markers.filter((mk) => mk.at > i && mk.at < end).map((mk) => mk.what))];
            found.push({
                part: part.name,
                para: p,
                at: p.offsets[i],
                loc: locate(p),
                where: p.where,
                text: body,
                ...classify(body),
                runs: runs.size,
                mixedFormat: rprs.size > 1,
                interrupts,
            });
            i = t.indexOf('<<', end);
        }
    }
    // Paragraphs are listed as they open, so a text box's paragraph comes after the text of
    // the paragraph around it; the XML offset puts instructions back in document order.
    found.sort((a, b) => a.at - b.at);
    return { found, problems, paras };
}

// Pairs starts with ends. Returns the instructions with depth and block links, plus problems.
function structure(part) {
    const { found, problems, paras } = instructionsOf(part);
    const stack = [];
    for (const ins of found) {
        ins.path = stack.map((s) => (s.inElse ? `${s.text}${ELSE_MARK}` : s.text));
        ins.depth = stack.length;
        if (STARTS.has(ins.kind)) {
            stack.push(ins);
            continue;
        }
        if (ins.kind === 'else') {
            const open = stack[stack.length - 1];
            ins.depth = Math.max(0, stack.length - 1);
            if (open) open.inElse = true;
            if (!open) {
                problems.push({ level: 'error', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> is not inside a block` });
            } else if (!['cs', 'cr'].includes(open.kind)) {
                problems.push({ level: 'warning', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> is inside <<${open.text}>> (${open.loc}), not a cs_ or cr_ block; check the <<es_>> isn't missing before it` });
            }
            continue;
        }
        if (ins.kind !== 'es' && ins.kind !== 'er') continue;

        ins.depth = Math.max(0, stack.length - 1);
        ins.path = ins.path.slice(0, -1);
        const open = stack[stack.length - 1];
        if (!open) {
            problems.push({ level: 'error', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> closes nothing` });
            continue;
        }
        const named = ins.name && !ins.name.startsWith('{') ? ins.name : '';
        if (named && open.name !== named) {
            const deeper = stack.findLastIndex((s) => s.name === named);
            if (deeper >= 0) {
                problems.push({ level: 'error', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> closes <<${stack[deeper].text}>> (${stack[deeper].loc}) while <<${open.text}>> (${open.loc}) is still open: the blocks cross` });
                stack.length = deeper;
                continue;
            }
            problems.push({ level: 'warning', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> is named differently from the block it closes, <<${open.text}>> (${open.loc})` });
        }
        if (!ENDS_FOR[ins.kind].has(open.kind)) {
            problems.push({ level: 'error', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> closes <<${open.text}>> (${open.loc}), which ends with <<${END_FOR[open.kind]}>>` });
        }
        stack.pop();
        open.end = ins;
        ins.start = open;
    }
    for (const open of stack) {
        problems.push({ level: 'error', part: part.name, loc: open.loc, msg: `<<${open.text}>> is never closed (expected <<${END_FOR[open.kind]}>>)` });
    }
    return { found, problems, paras };
}

function sameCell(a, b) {
    return a.table === b.table && a.row === b.row && a.cell === b.cell;
}

// A block normally wraps whole tables, whole rows, or content inside one cell. Docmosis
// renders blocks that cross a table edge (hmcts/docmosis has templates that do), but what
// it keeps or repeats is hard to predict, so those are warnings. A cs_ or rs_ whose ends are
// in different cells of one row it rejects. Row blocks are checked by rowTagProblems.
function layoutProblems(part, found) {
    const out = [];
    for (const s of found) {
        if (!s.end) continue;
        const a = s.where;
        const b = s.end.where;
        const label = `<<${s.text}>> (${s.loc}) … <<${s.end.text}>> (${s.end.loc})`;
        const common = (() => {
            let i = 0;
            while (i < a.length && i < b.length && a[i].table === b[i].table) i++;
            return i;
        })();
        if (common < a.length && common < b.length) {
            out.push({ level: 'warning', part: part.name, loc: s.loc, msg: `${label} start and end in different tables` });
            continue;
        }
        if (a.length !== b.length) {
            out.push({ level: 'warning', part: part.name, loc: s.loc, msg: `${label}: one end is inside a table and the other isn't` });
            continue;
        }
        if (!a.length) {
            if (s.kind === 'rr' || s.kind === 'cr') {
                out.push({ level: 'error', part: part.name, loc: s.loc, msg: `${label}: ${s.kind}_ is a table-row instruction but isn't in a table` });
            }
            continue;
        }
        const ia = a[a.length - 1];
        const ib = b[b.length - 1];
        if (sameCell(ia, ib) || s.kind === 'rr' || s.kind === 'cr') continue;
        if (ia.row === ib.row) {
            out.push({ level: 'error', part: part.name, loc: s.loc, msg: `${label} start and end in different cells of the same row, which Docmosis rejects as unmatched; keep both in one cell, or use ${s.kind === 'cs' ? 'cr_' : 'rr_'} rows` });
            continue;
        }
        out.push({ level: 'info', part: part.name, loc: s.loc, msg: `${label} spans rows ${ia.row}-${ib.row} of one table; check the rendered rows` });
    }
    return out;
}

// Docmosis rejects a table row holding more than one rr_, cr_ or er_, so a row block's start
// and end are always in different rows: the block is its first row to its last.
function rowTagProblems(part, found) {
    const out = [];
    const seen = new Map();
    for (const ins of found) {
        if (!['rr', 'cr', 'er'].includes(ins.kind) || !ins.where.length) continue;
        const key = ins.where.map((w) => `${w.table}.${w.row}`).join('>');
        const first = seen.get(key);
        if (!first) {
            seen.set(key, ins);
            continue;
        }
        const one = ins.start === first ? ` A ${first.kind}_ block needs at least two rows: <<${first.text}>> in its first row and <<${ins.text}>> in its last.` : '';
        out.push({ level: 'error', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> is in the same table row as <<${first.text}>> (${first.loc}), and Docmosis allows one rr_, cr_ or er_ per row.${one}` });
    }
    return out;
}

function splitProblems(part, found) {
    const out = [];
    for (const ins of found) {
        ins.interrupts = ins.interrupts.filter((w) => w !== 'proofErr');
        if (ins.interrupts.length) {
            out.push({ level: 'warning', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> has ${ins.interrupts.join(', ')} inside it` });
        } else if (ins.runs > 1 && ins.mixedFormat) {
            out.push({ level: 'warning', part: part.name, loc: ins.loc, msg: `<<${ins.text}>> is split across ${ins.runs} runs with different formatting` });
        }
    }
    const plain = found.filter((i) => i.runs > 1 && !i.mixedFormat && !i.interrupts.length).length;
    if (plain) {
        out.push({ level: 'info', part: part.name, loc: '', msg: `${plain} instruction(s) split across runs with the same formatting, which Docmosis joins` });
    }
    return out;
}

// ---------- data references ----------

const PREFIXED = /^(op|link|ref|html|image|img|bookmark|md):/;
const NOT_DATA = new Set(['true', 'false', 'null', 'and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'in', 'empty', 'instanceof', 'new']);
const TOKEN =
    /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|‘[^’]*’|“[^”]*”|\d+(?:\.\d+)?|\$[A-Za-z_]\w*|[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[\s*\d+\s*\])*|\S/g;

// The data names an instruction reads: function names, string literals, numbers, keywords,
// operators and $variables are dropped. A dotted name stays whole (address.line1), and a
// method call keeps its target (items.size() reads items).
export function dataRefs(instruction) {
    let b = instruction.trim();
    if (b.startsWith('/*')) return [];
    const kw = /^(cs|cr|rs|rr|es|er)_(.*)$/s.exec(b);
    if (kw) {
        if (kw[1] === 'es' || kw[1] === 'er') return [];
        b = kw[2];
    } else if (/^else(_|$)/.test(b)) {
        b = b.slice(5);
    } else if (PREFIXED.test(b)) {
        b = b.replace(PREFIXED, '');
    }
    const assign = /^\$[A-Za-z_]\w*\s*=(?!=)/.exec(b);
    if (assign) b = b.slice(assign[0].length);

    const refs = [];
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(b))) {
        const tok = m[0];
        if (!/^[A-Za-z_]/.test(tok)) continue;
        let name = tok.replace(/\s+/g, '');
        if (/^\s*\(/.test(b.slice(TOKEN.lastIndex))) {
            const dot = name.lastIndexOf('.');
            if (dot < 0) continue;
            name = name.slice(0, dot);
        }
        if (NOT_DATA.has(name.toLowerCase())) continue;
        if (!refs.includes(name)) refs.push(name);
    }
    return refs;
}

// ---------- API ----------

function locationOf(part, ins) {
    return {
        part: part.name,
        paragraph: ins.para.n,
        cells: ins.where.map((w) => ({ table: w.table, row: w.row, cell: w.cell })),
        label: ins.loc,
    };
}

// The template's text by part: one entry per top-level paragraph, and one per table row
// with its cells joined by " | " (paragraphs within a cell by " ¶ ").
export function text(template) {
    const flat = (s) => s.replace(/\n/g, ' ⏎ ');
    const cellText = (c) => c.children.map(blockText).filter(Boolean).join(' ¶ ');
    const rowText = (r) => r.cells.map(cellText).join(' | ');
    const blockText = (b) => (b.kind === 'para' ? flat(b.text) : `[${b.rows.map(rowText).join(' ¶ ')}]`);
    return partsOf(template).map((part) => {
        const lines = [];
        for (const b of parsePart(part.xml).root.children) {
            if (b.kind === 'para') lines.push({ kind: 'para', loc: `p${b.n}`, text: flat(b.text) });
            else for (const r of b.rows) lines.push({ kind: 'row', loc: `t${b.n}.r${r.n}`, text: rowText(r) });
        }
        return { part: part.name, lines };
    });
}

// Every instruction in document order, with its block depth.
// kind: cs, cr, rs, rr, es, er, else, comment or field.
export function fields(template) {
    const out = [];
    for (const part of partsOf(template)) {
        for (const ins of structure(part).found) {
            out.push({
                part: part.name,
                loc: ins.loc,
                location: locationOf(part, ins),
                depth: ins.depth,
                text: ins.text,
                kind: ins.kind,
                ...(ins.kind === 'field' ? { fieldKind: ins.sub } : {}),
                ...(ins.name !== undefined ? { name: ins.name } : {}),
                dataRefs: dataRefs(ins.text),
            });
        }
    }
    return out;
}

const TREE_TYPE = { cs: 'condition', cr: 'condition', rs: 'repeat', rr: 'repeat', else: 'else', comment: 'comment', field: 'field' };

// The instructions as a tree, one root per part. Conditions and repeats hold what is
// inside them as children; an else node, a child of its condition, holds the else branch.
// Nodes: { type: field|condition|repeat|else|comment, text, dataRefs, children, location },
// plus row (cr_/rr_), fieldKind (fields) and end (the location of a block's es_/er_).
// Unbalanced blocks don't throw: check() reports them.
export function instructionTree(template) {
    return partsOf(template).map((part) => {
        const { found } = structure(part);
        const root = { children: [] };
        const stack = [{ ins: null, container: root.children }];
        const nodeOf = new Map();
        for (const ins of found) {
            if (ins.kind === 'es' || ins.kind === 'er') {
                const open = ins.start && nodeOf.get(ins.start);
                if (!open) continue;
                open.end = locationOf(part, ins);
                const i = stack.findIndex((s) => s.ins === ins.start);
                if (i > 0) stack.length = i;
                continue;
            }
            const node = {
                type: TREE_TYPE[ins.kind],
                text: ins.text,
                dataRefs: dataRefs(ins.text),
                children: [],
                location: locationOf(part, ins),
            };
            if (ins.kind === 'cr' || ins.kind === 'rr') node.row = true;
            if (ins.kind === 'field') node.fieldKind = ins.sub;
            const top = stack[stack.length - 1];
            if (ins.kind === 'else') {
                const block = top.ins && nodeOf.get(top.ins);
                if (block) {
                    block.children.push(node);
                    top.container = node.children;
                    continue;
                }
            }
            top.container.push(node);
            if (STARTS.has(ins.kind)) {
                nodeOf.set(ins, node);
                stack.push({ ins, container: node.children });
            }
        }
        return { part: part.name, children: root.children };
    });
}

// Problems Docmosis rejects or mis-renders, errors first.
export function check(template) {
    const problems = [];
    let instructions = 0;
    for (const part of partsOf(template)) {
        const { found, problems: own } = structure(part);
        instructions += found.length;
        problems.push(...own, ...layoutProblems(part, found), ...rowTagProblems(part, found), ...splitProblems(part, found));
    }
    const rank = { error: 0, warning: 1, info: 2 };
    problems.sort((a, b) => rank[a.level] - rank[b.level]);
    return {
        instructions,
        errors: problems.filter((p) => p.level === 'error').length,
        warnings: problems.filter((p) => p.level === 'warning').length,
        problems,
    };
}

function flatten(template) {
    const items = [];
    for (const part of partsOf(template)) {
        const { found } = structure(part);
        for (const ins of found.filter((i) => i.kind !== 'es' && i.kind !== 'er')) {
            items.push({ key: `${part.name}\u0000${ins.path.join('\u0000')}\u0000${ins.text}`, text: ins.text, part: part.name, path: ins.path, loc: ins.loc });
        }
    }
    return items;
}

function lcsMatch(a, b) {
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const inA = new Set();
    const inB = new Set();
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i].key === b[j].key) {
            inA.add(i++);
            inB.add(j++);
        } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    return { inA, inB };
}

// Instructions added, removed and moved between two templates, matched in order by text
// and enclosing blocks; es_ and er_ are left out. Each item's path lists its enclosing
// blocks, and a block entry ending in ELSE_MARK means its else branch.
export function diff(oldTemplate, newTemplate) {
    const a = flatten(oldTemplate);
    const b = flatten(newTemplate);
    const { inA, inB } = lcsMatch(a, b);
    const strip = ({ key, ...rest }) => rest;
    const removed = a.filter((_, i) => !inA.has(i));
    const added = b.filter((_, i) => !inB.has(i));
    const moved = [];
    for (const r of [...removed]) {
        const k = added.findIndex((x) => x.text === r.text && x.part === r.part);
        if (k >= 0) {
            moved.push({ from: strip(r), to: strip(added[k]) });
            added.splice(k, 1);
            removed.splice(removed.indexOf(r), 1);
        }
    }
    return { added: added.map(strip), removed: removed.map(strip), moved, oldCount: a.length, newCount: b.length };
}

export { ELSE_MARK };

export function unpack(file, dir) {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new DocxError(`unpack needs a .docx file: ${file}`);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new DocxError(`${dir} exists and isn't empty`);
    const entries = zipOpen(file);
    for (const { name } of entries) {
        if (/^[\\/]|^[A-Za-z]:|\\|(^|\/)\.\.(\/|$)/.test(name)) throw new DocxError(`${file} has an entry outside its folder: ${name}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ORDER_FILE), `${entries.map((e) => e.name).join('\n')}\n`);
    for (const e of entries) {
        const f = path.join(dir, e.name);
        const data = e.read();
        fs.mkdirSync(path.dirname(f), { recursive: true });
        if (CONTENT_PART.test(e.name)) {
            const keep = path.join(dir, ORIGINAL_DIR, e.name);
            fs.mkdirSync(path.dirname(keep), { recursive: true });
            fs.writeFileSync(keep, data);
            fs.utimesSync(keep, e.mtime, e.mtime);
            fs.writeFileSync(f, data.toString('utf8').replace(BREAK_BEFORE, '\n'));
        } else {
            fs.writeFileSync(f, data);
        }
        fs.utimesSync(f, e.mtime, e.mtime);
    }
    return { file, dir };
}

// The files pack zips: every entry unpack recorded in ORDER_FILE that is still there, and new
// files under the folders a .docx keeps its parts in. Editor backups, swap files, dotfiles
// (but not _rels/.rels, the package relationships) and anything else are skipped and
// returned, so the caller can say so.
const PART_DIRS = new Set(['word', 'customXml', 'docProps', '_rels']);
const isJunk = (name) => name.split('/').some((s, i, all) => s.startsWith('.') && !(s === '.rels' && all[i - 1] === '_rels')) || /(~|\.swp|\.swo)$/.test(name) || /(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(name);

function packEntries(dir) {
    const orderFile = path.join(dir, ORDER_FILE);
    const saved = fs.existsSync(orderFile) ? fs.readFileSync(orderFile, 'utf8').split('\n').filter(Boolean) : [];
    const present = walkDir(dir);
    const recorded = new Set(saved);
    const include = [];
    const skipped = [];
    for (const n of present) {
        const ok = recorded.has(n) || n === '[Content_Types].xml' || (PART_DIRS.has(n.split('/')[0]) && n.includes('/') && !isJunk(n));
        (ok ? include : skipped).push(n);
    }
    return { saved, include, skipped };
}

// Entries go in the original file's order, which unpack saved in ORDER_FILE, so an
// unchanged folder packs back to the same bytes. New parts follow, and
// [Content_Types].xml is always first, as Word writes it.
function packOrder(saved, names) {
    const present = new Set(names);
    const known = saved.filter((n) => present.has(n));
    const knownSet = new Set(known);
    const rank = (n) => (n.startsWith('_rels/') ? 1 : n.startsWith('docProps/') ? 2 : 3);
    const extra = names.filter((n) => !knownSet.has(n)).sort((x, y) => rank(x) - rank(y) || (x < y ? -1 : x > y ? 1 : 0));
    const all = [...known, ...extra];
    return ['[Content_Types].xml', ...all.filter((n) => n !== '[Content_Types].xml')];
}

// Undoes unpack's line breaks. A part whose content is unchanged gets its original bytes
// back, including any line breaks the original file had.
function contentPart(dir, name) {
    const edited = fs.readFileSync(path.join(dir, name), 'utf8').replace(UNBREAK, '');
    const keep = path.join(dir, ORIGINAL_DIR, name);
    if (fs.existsSync(keep)) {
        const original = fs.readFileSync(keep);
        if (original.toString('utf8').replace(UNBREAK, '') === edited) return original;
    }
    return edited;
}

// Returns { dir, file, skipped }, skipped being the files in dir that were left out.
// The .docx is zipped beside the target and checked before it replaces it, so on broken XML
// the target is untouched, and this throws with exitCode 1 and details listing the problems.
export function pack(dir, file) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new DocxError(`pack needs a folder: ${dir}`);
    const { saved, include: names, skipped } = packEntries(dir);
    if (!names.includes('[Content_Types].xml')) throw new DocxError(`${dir} has no [Content_Types].xml`);
    if (!names.includes('word/document.xml')) throw new DocxError(`${dir} has no word/document.xml`);

    const files = packOrder(saved, names).map((name) => {
        const src = path.join(dir, name);
        const data = CONTENT_PART.test(name) ? Buffer.from(contentPart(dir, name)) : fs.readFileSync(src);
        return { name, data, mtime: fs.statSync(src).mtime };
    });
    const errors = [];
    for (const { name, data } of files.filter((x) => x.name.endsWith('.xml') || x.name.endsWith('.rels'))) {
        const problem = xmlProblem(data.toString('utf8'));
        if (problem) errors.push(`${name}: ${problem}`);
    }
    if (errors.length) {
        throw new DocxError(`the XML is broken, so ${file} was not written:\n  ${errors.join('\n  ')}`, { exitCode: 1, details: errors });
    }
    const out = path.resolve(file);
    const tmp = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}-${Date.now()}.tmp`);
    try {
        fs.writeFileSync(tmp, zipBuild(files));
        fs.renameSync(tmp, out);
        return { dir, file, skipped };
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}

const ENTITY = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/y;
const XML_TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_:][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

// The first problem in an XML part an edit is likely to cause: a tag closed out of order or
// never closed, an & that doesn't start an entity, or a < that doesn't start markup.
export function xmlProblem(xml) {
    const stack = [];
    const badAmp = (s, at) => {
        for (let i = s.indexOf('&'); i >= 0; i = s.indexOf('&', i + 1)) {
            ENTITY.lastIndex = i;
            if (!ENTITY.test(s)) return `"&" at offset ${at + i} isn't an entity; write &amp;`;
        }
        return null;
    };
    let last = 0;
    let m;
    XML_TOKEN.lastIndex = 0;
    while ((m = XML_TOKEN.exec(xml))) {
        const between = xml.slice(last, m.index);
        const lt = between.indexOf('<');
        if (lt >= 0) return `"<" at offset ${last + lt} doesn't start a tag; write &lt;`;
        const amp = badAmp(between, last);
        if (amp) return amp;
        last = m.index + m[0].length;
        if (!m[2]) continue;
        const attrs = m[3];
        if (attrs.includes('<')) return `"<" inside <${m[2]}> at offset ${m.index}; write &lt;`;
        const attrAmp = badAmp(attrs, m.index + 1 + m[1].length + m[2].length);
        if (attrAmp) return attrAmp;
        if (m[4]) continue;
        if (!m[1]) stack.push(m[2]);
        else if (stack.pop() !== m[2]) return `</${m[2]}> at offset ${m.index} doesn't close the open element`;
    }
    const rest = xml.slice(last);
    if (rest.includes('<')) return `"<" at offset ${last + rest.indexOf('<')} doesn't start a tag; write &lt;`;
    const amp = badAmp(rest, last);
    if (amp) return amp;
    if (stack.length) return `<${stack[stack.length - 1]}> is never closed`;
    return null;
}

// ---------- CLI ----------

function formatText(parts) {
    const lines = [];
    for (const { part, lines: rows } of parts) {
        lines.push(`== ${part}`);
        for (const r of rows) lines.push(`${r.loc}\t${r.text}`);
    }
    return lines.join('\n');
}

function formatFields(list) {
    const out = [];
    for (const part of [...new Set(list.map((i) => i.part))]) {
        const rows = list.filter((i) => i.part === part);
        out.push(`== ${part}`);
        const width = Math.max(...rows.map((i) => i.loc.length));
        for (const ins of rows) out.push(`${ins.loc.padEnd(width)}  ${'  '.repeat(ins.depth)}<<${ins.text}>>`);
    }
    return out.join('\n');
}

function formatCheck(result) {
    const lines = result.problems.map((p) => `${p.level.padEnd(7)} ${p.part}${p.loc ? ` ${p.loc}` : ''}: ${p.msg}`);
    lines.push(`${result.instructions} instructions, ${result.errors} error(s), ${result.warnings} warning(s)`);
    return lines.join('\n');
}

function formatDiff(d) {
    const where = (x) => (x.part === 'word/document.xml' ? x.loc : `${x.part} ${x.loc}`);
    const block = (p) => (p.endsWith(ELSE_MARK) ? `<<${p.slice(0, -1)}>> (else)` : `<<${p}>>`);
    const ctx = (x) => (x.path.length ? ` in ${x.path.map(block).join(' > ')}` : ' at top level');
    const lines = [];
    const section = (title, rows) => {
        lines.push(`${title} (${rows.length})`);
        for (const r of rows) lines.push(`  ${r}`);
    };
    section('Added', d.added.map((x) => `+ <<${x.text}>>${ctx(x)}  [${where(x)}]`));
    section('Removed', d.removed.map((x) => `- <<${x.text}>>${ctx(x)}  [${where(x)}]`));
    section(
        'Moved',
        d.moved.map(({ from, to }) => {
            const moved = from.path.join() === to.path.join() ? ' (same block, new position)' : `${ctx(from)} -> ${ctx(to).trim()}`;
            return `~ <<${to.text}>>${moved}  [${from.loc} -> ${to.loc}]`;
        }),
    );
    lines.push(`${d.oldCount} -> ${d.newCount} instructions, not counting es_ and er_`);
    return lines.join('\n');
}

const COMMANDS = {
    text: [1, ([t]) => formatText(text(t))],
    fields: [1, ([t]) => formatFields(fields(t))],
    tree: [1, ([t]) => JSON.stringify(instructionTree(t), null, 2)],
    check: [
        1,
        ([t]) => {
            const result = check(t);
            return { out: formatCheck(result), code: result.errors ? 1 : 0 };
        },
    ],
    diff: [2, ([a, b]) => formatDiff(diff(a, b))],
    unpack: [2, ([f, d]) => (unpack(f, d), `unpacked ${f} to ${d}`)],
    pack: [
        2,
        ([d, f]) => {
            const { skipped } = pack(d, f);
            for (const n of skipped) process.stderr.write(`skipped ${n}: not a part of the .docx\n`);
            return `packed ${d} to ${f}`;
        },
    ],
};

export function main(argv) {
    const [cmd, ...args] = argv;
    if (cmd === '-h' || cmd === '--help') {
        process.stdout.write(`${usage}\n`);
        return 0;
    }
    const entry = COMMANDS[cmd];
    if (!entry || args.length < entry[0]) {
        process.stderr.write(`${usage}\n`);
        return 2;
    }
    try {
        const result = entry[1](args);
        const { out, code } = typeof result === 'string' ? { out: result, code: 0 } : result;
        process.stdout.write(`${out}\n`);
        return code;
    } catch (e) {
        if (!(e instanceof DocxError)) throw e;
        process.stderr.write(`${e.message}\n`);
        return e.exitCode;
    }
}

function invokedDirectly() {
    try {
        return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (invokedDirectly()) {
    process.stdout.on('error', (e) => {
        if (e.code !== 'EPIPE') throw e;
        process.exit(process.exitCode ?? 0);
    });
    process.exitCode = main(process.argv.slice(2));
}
