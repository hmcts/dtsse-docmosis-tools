import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { docmosisToolsAlias } from './aliases.mjs';

export default defineConfig({
  resolve: {
    alias: { ...docmosisToolsAlias, vscode: fileURLToPath(new URL('./test/vscodeStub.ts', import.meta.url)) },
  },
});
