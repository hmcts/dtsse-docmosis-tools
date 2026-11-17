#!/usr/bin/env node
// Read, check, edit and render Docmosis template files (.docx).
//
// Usage: docmosis <command> [args]   (docmosis --help for detail)
//
// Templates are read and edited as files. render-file sends one, with its data, to the hosted
// dtsse-doc-render.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { main as docx } from '../lib/docx.mjs';
import { FORMATS, RenderError, RenderUnreachable, renderFile } from '../lib/render.mjs';

const RED = process.stderr.isTTY ? '\x1b[31m' : '';
const RESET = process.stderr.isTTY ? '\x1b[0m' : '';

class Exit extends Error {
    constructor(code) {
        super(`exit ${code}`);
        this.code = code;
    }
}

const die = (msg) => {
    process.stderr.write(`${RED}${msg}${RESET}\n`);
    throw new Exit(1);
};

const vpnDownDie = (msg) => die(`${msg}: the VPN is probably down; check it with f5-cli status`);

const USAGE = `usage: docmosis <command> [args]

Template files (no network):
  text <template>                the template's text, one paragraph per line; a table row
                                 is one line with its cells separated by " | "
  fields <template>              the Docmosis instructions in document order, indented by
                                 block, with the paragraph and table cell of each
  tree <template>                the instructions as a JSON tree, with the data names
                                 each one reads
  check <template>               problems Docmosis rejects or mis-renders: unbalanced or
                                 crossed blocks, "<<" without ">>", instructions split
                                 across differently formatted runs; exits 1 on errors
  diff <old> <new>               instructions and blocks added, removed and moved
  unpack <file.docx> <dir>       extract a template for editing; the document, header and
                                 footer XML get one table, row, cell or paragraph per line
  pack <dir> <file.docx>         zip an unpacked folder back into a .docx; unchanged parts
                                 keep their original bytes
  <template> is a .docx file or a folder made by unpack.

Rendering (dtsse-doc-render; needs the VPN):
  render-file <file.docx> <data.json> [--out file] [--format F] [--dev]
                                 render a template file from your machine. The file is sent
                                 with the request, so nothing is uploaded or stored and an
                                 edited file is never stale. F is pdf (default), docx, doc,
                                 odt, html or txt; a docx can be read with text and diff.
                                 --dev renders field errors into the document instead of
                                 failing. DOC_RENDER_URL overrides the service
                                 (default https://doc-render.aat.platform.hmcts.net).
  dtsse-doc-render implements a subset of the Docmosis template language, so a successful
  render is not proof that a template works in Docmosis. If it can't be reached, the VPN is
  probably down.

Examples:
  docmosis unpack Claim-Pack-V2.docx /tmp/v2 && $EDITOR /tmp/v2/word/document.xml
  docmosis pack /tmp/v2 Claim-Pack-V2.docx && docmosis check Claim-Pack-V2.docx
  docmosis render-file Claim-Pack-V2.docx payload.json --dev
`;

const usage = () => process.stderr.write(USAGE);

const isFile = (p) => !!p && fs.existsSync(p) && fs.statSync(p).isFile();
const isDir = (p) => !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
const exists = (p) => !!p && fs.existsSync(p);

function parse(argv) {
    const { tokens } = parseArgs({
        args: argv,
        strict: false,
        allowPositionals: true,
        tokens: true,
        options: {
            help: { type: 'boolean', short: 'h' },
            out: { type: 'string' },
            dev: { type: 'boolean' },
            format: { type: 'string' },
        },
    });
    const opts = { out: '', dev: false, format: 'pdf' };
    const args = [];
    for (const t of tokens) {
        if (t.kind === 'positional') args.push(t.value);
        else if (t.kind === 'option-terminator') die('unknown option -- (see --help)');
        else if (t.name === 'help') return { help: true };
        else if (t.name === 'out' || t.name === 'format') {
            if (t.value === undefined) die(`${t.rawName} needs a value`);
            opts[t.name] = t.value;
        } else if (t.name === 'dev') opts.dev = true;
        else if (t.rawName.startsWith('--')) die(`unknown option ${t.rawName} (see --help)`);
        else args.push(t.rawName);
    }
    return { args, ...opts };
}

async function renderFileCommand(file, dataPath, { out, format, dev }) {
    if (!(isFile(file) && file.endsWith('.docx') && isFile(dataPath))) die('render-file needs a .docx file and a data .json file');
    let data;
    try {
        data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch {
        die(`${dataPath} is not valid JSON`);
    }
    const target = out || `${path.basename(file, path.extname(file))}.${format}`;
    let result;
    try {
        result = await renderFile({ template: file, data, format, devMode: dev });
    } catch (e) {
        if (e instanceof RenderUnreachable) vpnDownDie(e.message);
        if (e instanceof RenderError) {
            process.stderr.write(`${e.message}\n${e.lines.join('\n')}\n`);
            throw new Exit(1);
        }
        throw e;
    }
    fs.writeFileSync(target, result.bytes);
    process.stdout.write(`rendered ${target} (${result.bytes.length} bytes)\n`);
}

async function run(argv) {
    const parsed = parse(argv);
    if (parsed.help) {
        usage();
        return 0;
    }
    const { args, format } = parsed;
    const [command, a, b] = args;
    if (!command) {
        usage();
        return 2;
    }
    if (!FORMATS.includes(format)) die(`--format is one of: ${FORMATS.join(' ')}`);

    switch (command) {
        case 'render-file':
            await renderFileCommand(a, b, parsed);
            return 0;
        case 'fields':
        case 'check':
        case 'text':
        case 'tree':
            if (!exists(a)) die(`${command} needs a .docx file or an unpacked folder`);
            return docx([command, a]);
        case 'diff':
            if (!(exists(a) && exists(b))) die('diff needs two templates');
            return docx(['diff', a, b]);
        case 'unpack':
            if (!(isFile(a) && b)) die('unpack needs a .docx file and a folder');
            return docx(['unpack', a, b]);
        case 'pack':
            if (!(isDir(a) && b)) die('pack needs a folder and a .docx file');
            return docx(['pack', a, b]);
        default:
            return die(`unknown command ${command} (see --help)`);
    }
}

process.stdout.on('error', (e) => {
    if (e.code !== 'EPIPE') throw e;
    process.exit(process.exitCode ?? 0);
});

try {
    process.exitCode = await run(process.argv.slice(2));
} catch (e) {
    if (!(e instanceof Exit)) throw e;
    process.exitCode = e.code;
}
