import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const SETTING_SECTION = 'hmctsTemplatePreview';
export const SETTING_KEY = 'terminalCommand';

/** NODE_USE_ENV_PROXY arrived in Node 24 and was backported to 22.21. */
export function supportsEnvProxy(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major >= 24 || (major === 22 && minor >= 21);
}

interface Runtime {
  node: string;
  flags: string;
  proxy: boolean;
  launcher: string;
}

const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const cmdQuote = (value: string): string => value.replace(/%/g, '%%');

export function shStub(r: Runtime): string {
  return [
    '#!/bin/sh',
    `DOCMOSIS_VSCODE_NODE=${shQuote(r.node)} DOCMOSIS_VSCODE_NODE_FLAGS=${shQuote(r.flags)} DOCMOSIS_VSCODE_NODE_PROXY=${r.proxy ? 1 : 0} exec ${shQuote(r.launcher)} "$@"`,
    '',
  ].join('\n');
}

/** Runs the launcher without call, so cmd neither returns here nor expands the arguments twice. */
export function cmdStub(r: Runtime): string {
  return [
    '@echo off',
    'setlocal',
    `set "DOCMOSIS_VSCODE_NODE=${cmdQuote(r.node)}"`,
    `set "DOCMOSIS_VSCODE_NODE_FLAGS=${cmdQuote(r.flags)}"`,
    `set "DOCMOSIS_VSCODE_NODE_PROXY=${r.proxy ? 1 : 0}"`,
    `"${cmdQuote(r.launcher)}.cmd" %*`,
    '',
  ].join('\r\n');
}

/**
 * Writes the stubs the terminal PATH points at. The PATH entry has to survive extension
 * updates and the VS Code build changing under a remote server, so it names a fixed
 * directory and the stubs, rewritten on every activation, name the current paths.
 */
export function writeStubs(context: vscode.ExtensionContext): string {
  const dir = path.join(context.globalStorageUri.fsPath, 'bin');
  const runtime: Runtime = {
    node: process.execPath,
    flags: process.allowedNodeEnvironmentFlags.has('--use-system-ca') ? '--use-system-ca' : '',
    proxy: supportsEnvProxy(process.versions.node),
    launcher: path.join(context.extensionPath, 'dist', 'cli', 'docmosis'),
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docmosis'), shStub(runtime), { mode: 0o755 });
  fs.chmodSync(path.join(dir, 'docmosis'), 0o755);
  fs.writeFileSync(path.join(dir, 'docmosis.cmd'), cmdStub(runtime));
  return dir;
}

/** Puts the bundled docmosis command on the PATH of new integrated terminals, or takes it off. */
export function applyTerminalCommand(context: vscode.ExtensionContext): void {
  const collection = context.environmentVariableCollection;
  collection.clear();
  const enabled = vscode.workspace.getConfiguration(SETTING_SECTION).get<boolean>(SETTING_KEY, true);
  if (!enabled) return;

  let dir: string;
  try {
    dir = writeStubs(context);
  } catch (error) {
    console.error(`hmcts-template-preview: could not write the docmosis stubs: ${error}`);
    return;
  }
  collection.description = 'HMCTS Template Preview: adds the docmosis command';
  collection.prepend('PATH', dir + path.delimiter);
}

export function watchTerminalCommand(context: vscode.ExtensionContext): vscode.Disposable {
  applyTerminalCommand(context);
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SETTING_SECTION}.${SETTING_KEY}`)) applyTerminalCommand(context);
  });
}
