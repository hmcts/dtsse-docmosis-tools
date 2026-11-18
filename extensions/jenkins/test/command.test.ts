import { describe, expect, it } from 'vitest';
import { findOnPath, splitCommand, vpnStateFromExit } from '../src/core/command';

describe('splitCommand', () => {
  it('splits on whitespace', () => {
    expect(splitCommand('  hai --bg  --x ')).toEqual({ command: 'hai', args: ['--bg', '--x'] });
    expect(splitCommand('hai')).toEqual({ command: 'hai', args: [] });
    expect(splitCommand('')).toEqual({ command: '', args: [] });
  });
});

describe('findOnPath', () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);
  it('finds a command in PATH', () => {
    expect(findOnPath('hai', '/a::/b', exists(['/b/hai']))).toBe('/b/hai');
  });
  it('tries extensions', () => {
    expect(findOnPath('hai', '/a', exists(['/a/hai.cmd']), ['', '.cmd'])).toBe('/a/hai.cmd');
  });
  it('returns undefined when absent, empty or PATH unset', () => {
    expect(findOnPath('hai', '/a', exists([]))).toBeUndefined();
    expect(findOnPath('hai', undefined, exists([]))).toBeUndefined();
    expect(findOnPath('', '/a', exists([]))).toBeUndefined();
  });
  it('checks explicit paths directly', () => {
    expect(findOnPath('/x/hai', '', exists(['/x/hai']))).toBe('/x/hai');
    expect(findOnPath('.\\hai', '', exists([]))).toBeUndefined();
  });
});

describe('vpnStateFromExit', () => {
  it('maps exit codes', () => {
    expect(vpnStateFromExit(0, false)).toBe('up');
    expect(vpnStateFromExit(1, false)).toBe('down');
    expect(vpnStateFromExit(null, false)).toBe('unknown');
    expect(vpnStateFromExit(127, true)).toBe('unknown');
  });
});
