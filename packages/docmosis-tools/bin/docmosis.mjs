#!/usr/bin/env node
// Node's fetch reads HTTPS_PROXY and NO_PROXY, and the system certificate store, only when
// the process starts with these switches. A launch that lacks them, such as npm's Windows
// shim, restarts Node with them; DOCMOSIS_RESTARTED stops that from looping.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nodeOptions = process.env.NODE_OPTIONS ?? '';
const hasSystemCa = process.execArgv.includes('--use-system-ca') || nodeOptions.includes('--use-system-ca');
const hasEnvProxy = process.env.NODE_USE_ENV_PROXY === '1';

if (!(hasSystemCa && hasEnvProxy) && !process.env.DOCMOSIS_RESTARTED) {
    const child = spawn(
        process.execPath,
        ['--use-system-ca', ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
        { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', DOCMOSIS_RESTARTED: '1' } },
    );
    // Asynchronous, so a signal sent to this process reaches the child instead of orphaning it.
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const forward = (signal) => child.kill(signal);
    for (const signal of signals) process.on(signal, forward);
    child.on('error', (error) => {
        console.error(`could not restart Node: ${error.message}`);
        process.exit(1);
    });
    child.on('close', (status, signal) => {
        for (const s of signals) process.off(s, forward);
        if (signal) process.kill(process.pid, signal);
        else process.exitCode = status ?? 1;
    });
} else {
    await import('../lib/cli.mjs');
}
