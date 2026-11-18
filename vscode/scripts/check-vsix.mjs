// Fails unless every file the extension loads at runtime is in the vsix, and dist/cli/docmosis is
// stored with mode 0755, which the extension's stub relies on to exec it. Reads the zip's central
// directory: the Unix mode is the high half of each entry's external attributes.
import { readFileSync } from 'node:fs';

const file = new URL('../hmcts-template-preview.vsix', import.meta.url);
const zip = readFileSync(file);
let eocd = zip.length - 22;
while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
if (eocd < 0) throw new Error(`${file.pathname} is not a zip`);

const entries = zip.readUInt16LE(eocd + 10);
let offset = zip.readUInt32LE(eocd + 16);
const modes = new Map();
for (let i = 0; i < entries; i++) {
  const nameLength = zip.readUInt16LE(offset + 28);
  const extraLength = zip.readUInt16LE(offset + 30);
  const commentLength = zip.readUInt16LE(offset + 32);
  const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
  modes.set(name, (zip.readUInt32LE(offset + 38) >>> 16) & 0o777);
  offset += 46 + nameLength + extraLength + commentLength;
}

const required = [
  'extension/dist/extension.js',
  'extension/dist/webview.js',
  'extension/dist/webview.css',
  'extension/dist/pdf.worker.min.mjs',
  'extension/dist/notify-picker.js',
  'extension/dist/notify-editor.js',
  'extension/dist/notify.css',
  'extension/dist/cli/docmosis-cli.mjs',
  'extension/dist/cli/docmosis.cmd',
  'extension/media/icon.png',
  'extension/media/notify.svg',
  'extension/media/templates.svg',
];
const absent = required.filter((name) => !modes.has(name));
if (absent.length > 0) {
  console.error(`${file.pathname} is missing ${absent.join(', ')}`);
  process.exit(1);
}

const entry = 'extension/dist/cli/docmosis';
const mode = modes.get(entry);
if (mode !== 0o755) {
  console.error(`${file.pathname}: ${entry} has mode ${mode === undefined ? 'missing' : mode.toString(8)}, expected 755`);
  process.exit(1);
}
console.log(`${file.pathname}: has the ${required.length} runtime files, and ${entry} is 755`);
