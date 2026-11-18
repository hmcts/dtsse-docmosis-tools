import { describe, expect, it } from 'vitest';
import { formatDuration, relativeTime } from '../src/core/format';

describe('format', () => {
  it.each([
    [-5, '0s'],
    [45_000, '45s'],
    [14 * 60_000, '14m'],
    [3_600_000, '1h'],
    [3_900_000, '1h 5m'],
  ])('formats %d ms as %s', (ms, text) => expect(formatDuration(ms)).toBe(text));

  it.each([
    [0, 'just now'],
    [-10_000, 'just now'],
    [5 * 60_000, '5m ago'],
    [3 * 3_600_000, '3h ago'],
    [50 * 3_600_000, '2d ago'],
  ])('formats %d ms ago as %s', (ago, text) =>
    expect(relativeTime(1_000_000_000 - ago, 1_000_000_000)).toBe(text),
  );
});
