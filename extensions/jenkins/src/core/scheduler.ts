export const PENDING_POLL_MS = 30_000;
export const IDLE_POLL_MS = 300_000;

export function nextPollDelay(hasPending: boolean): number {
  return hasPending ? PENDING_POLL_MS : IDLE_POLL_MS;
}

export interface Lease {
  windowId: string;
  heartbeat: number;
}

/** Leases are stale after two idle poll intervals, long enough for the leader to miss one poll. */
export const LEASE_STALE_MS = IDLE_POLL_MS * 2;

export function acquireLease(
  current: Lease | undefined,
  windowId: string,
  now: number,
  staleMs: number = LEASE_STALE_MS,
): { leader: boolean; lease: Lease } {
  if (!current || current.windowId === windowId || now - current.heartbeat > staleMs) {
    return { leader: true, lease: { windowId, heartbeat: now } };
  }
  return { leader: false, lease: current };
}

export function releaseLease(current: Lease | undefined, windowId: string): Lease | undefined {
  return current?.windowId === windowId ? undefined : current;
}
