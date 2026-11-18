import { describe, expect, it } from 'vitest';
import { acquireLease, LEASE_STALE_MS, nextPollDelay, releaseLease } from '../src/core/scheduler';

describe('nextPollDelay', () => {
  it('polls faster while a build is pending', () => {
    expect(nextPollDelay(true)).toBe(30_000);
    expect(nextPollDelay(false)).toBe(300_000);
  });
});

describe('leader lease', () => {
  it('is taken when none exists', () => {
    expect(acquireLease(undefined, 'a', 10)).toEqual({
      leader: true,
      lease: { windowId: 'a', heartbeat: 10 },
    });
  });
  it('is renewed by its owner', () => {
    expect(acquireLease({ windowId: 'a', heartbeat: 10 }, 'a', 99).lease.heartbeat).toBe(99);
  });
  it('is kept by a live owner', () => {
    const lease = { windowId: 'a', heartbeat: 10 };
    expect(acquireLease(lease, 'b', 10 + LEASE_STALE_MS)).toEqual({ leader: false, lease });
  });
  it('is taken over when stale', () => {
    expect(acquireLease({ windowId: 'a', heartbeat: 10 }, 'b', 11 + LEASE_STALE_MS)).toEqual({
      leader: true,
      lease: { windowId: 'b', heartbeat: 11 + LEASE_STALE_MS },
    });
  });
  it('is released only by its owner', () => {
    const lease = { windowId: 'a', heartbeat: 1 };
    expect(releaseLease(lease, 'a')).toBeUndefined();
    expect(releaseLease(lease, 'b')).toBe(lease);
    expect(releaseLease(undefined, 'b')).toBeUndefined();
  });
});
