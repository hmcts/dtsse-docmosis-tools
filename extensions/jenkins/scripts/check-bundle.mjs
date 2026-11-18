// Fails unless the extension host can load the bundle named by package.json `main` and find activate().
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const main = new URL(`../${pkg.main}`, import.meta.url).pathname;

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return new Proxy({}, { get: () => new Proxy(() => {}, { get: () => () => {} }) });
  return load.call(this, request, ...rest);
};

let extension;
try {
  extension =
    main.endsWith('.cjs') || pkg.type !== 'module'
      ? createRequire(import.meta.url)(main)
      : await import(main);
} catch (error) {
  console.error(`${pkg.main} does not load: ${error.message}`);
  process.exit(1);
}
if (typeof extension.activate !== 'function') {
  console.error(`${pkg.main} does not export activate()`);
  process.exit(1);
}
console.log(`${pkg.main}: loads and exports activate()`);
