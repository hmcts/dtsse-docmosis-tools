import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootPackage = fileURLToPath(new URL('../package.json', import.meta.url));

/** True once the repo root is the published-shape @hmcts-cft/docmosis-tools package. */
const rootIsPackage = () => existsSync(rootPackage) && JSON.parse(readFileSync(rootPackage, 'utf8')).exports !== undefined;

/** Bundler aliases: the temporary shim until the root package exists, then nothing. */
export const docmosisToolsAlias = rootIsPackage()
  ? {}
  : { '@hmcts-cft/docmosis-tools': fileURLToPath(new URL('./shim/docmosis-tools.mjs', import.meta.url)) };
