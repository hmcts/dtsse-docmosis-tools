// Fails unless every file the extension loads at runtime is in the vsix. Reads the zip's central directory.
import { readFileSync } from 'node:fs';

const file = new URL('../hmcts-notify.vsix', import.meta.url);
const zip = readFileSync(file);
let eocd = zip.length - 22;
while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
if (eocd < 0) throw new Error(`${file.pathname} is not a zip`);

const entries = zip.readUInt16LE(eocd + 10);
let offset = zip.readUInt32LE(eocd + 16);
const names = new Set();
for (let i = 0; i < entries; i++) {
  const nameLength = zip.readUInt16LE(offset + 28);
  const extraLength = zip.readUInt16LE(offset + 30);
  const commentLength = zip.readUInt16LE(offset + 32);
  names.add(zip.toString('utf8', offset + 46, offset + 46 + nameLength));
  offset += 46 + nameLength + extraLength + commentLength;
}

const required = [
  'extension/dist/extension.js',
  'extension/dist/notify-picker.js',
  'extension/dist/notify-editor.js',
  'extension/dist/webview.css',
  'extension/dist/notify.css',
  'extension/media/icon.png',
  'extension/media/notify.svg',
];
const absent = required.filter((name) => !names.has(name));
if (absent.length > 0) {
  console.error(`${file.pathname} is missing ${absent.join(', ')}`);
  process.exit(1);
}
console.log(`${file.pathname}: has the ${required.length} runtime files`);
