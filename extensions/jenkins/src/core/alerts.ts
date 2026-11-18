import type { OpenPr, PrStatus } from './github';

export type PrBuildState = 'pending' | 'success' | 'failure' | 'error';

export interface JenkinsPrStatus {
  state: PrBuildState;
  targetUrl?: string;
}

export interface AlertState {
  prs: Record<string, { sha: string; state: PrBuildState }>;
  inputs: string[];
}

export interface FinishedEvent {
  pr: OpenPr;
  state: 'success' | 'failure' | 'error';
  targetUrl?: string;
}

export const EMPTY_ALERT_STATE: AlertState = { prs: {}, inputs: [] };

const STATE_MAP: Record<PrStatus['state'], PrBuildState> = {
  PENDING: 'pending',
  EXPECTED: 'pending',
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'error',
};

/** The Jenkins status of a PR; `pr-head` is the build of the PR head itself, so it wins over `pr-merge`. */
export function jenkinsStatusOf(statuses: PrStatus[]): JenkinsPrStatus | undefined {
  const jenkins = statuses.filter((status) => status.context.toLowerCase().includes('jenkins'));
  const chosen = jenkins.find((status) => status.context.endsWith('pr-head')) ?? jenkins[0];
  if (!chosen) return undefined;
  const result: JenkinsPrStatus = { state: STATE_MAP[chosen.state] };
  if (chosen.targetUrl) result.targetUrl = chosen.targetUrl;
  return result;
}

export function prKey(pr: Pick<OpenPr, 'slug' | 'number'>): string {
  return `${pr.slug}#${pr.number}`;
}

export function anyPending(prs: OpenPr[]): boolean {
  return prs.some((pr) => jenkinsStatusOf(pr.statuses)?.state === 'pending');
}

/**
 * A build is reported when it goes from pending to finished, or when a new head commit appears on a
 * PR already being tracked (its pending state may have passed between polls). A PR seen for the first
 * time only sets a baseline, so a reload or a new window never replays old results.
 */
export function evaluate(previous: AlertState, prs: OpenPr[]): { next: AlertState; events: FinishedEvent[] } {
  const next: AlertState = { prs: {}, inputs: previous.inputs };
  const events: FinishedEvent[] = [];
  for (const pr of prs) {
    const status = jenkinsStatusOf(pr.statuses);
    if (!status) continue;
    const key = prKey(pr);
    const seen = previous.prs[key];
    next.prs[key] = { sha: pr.headSha, state: status.state };
    if (!seen || status.state === 'pending') continue;
    const wasPending = seen.sha !== pr.headSha || seen.state === 'pending';
    if (wasPending) {
      const event: FinishedEvent = { pr, state: status.state };
      if (status.targetUrl) event.targetUrl = status.targetUrl;
      events.push(event);
    }
  }
  return { next, events };
}

/** Marks a paused build as notified; returns false when it already was. */
export function markInput(state: AlertState, buildUrl: string): { state: AlertState; isNew: boolean } {
  if (state.inputs.includes(buildUrl)) return { state, isNew: false };
  return { state: { ...state, inputs: [...state.inputs, buildUrl].slice(-100) }, isNew: true };
}

export interface AlertDetail {
  failedStage?: string;
  durationMs?: number;
}

export function formatAlert(event: FinishedEvent, detail: AlertDetail = {}): string {
  const verb = event.state === 'success' ? 'passed' : event.state === 'failure' ? 'failed' : 'errored';
  const head = `${event.pr.repo} PR #${event.pr.number} ${verb}`;
  const parts: string[] = [];
  if (detail.failedStage) parts.push(detail.failedStage);
  if (detail.durationMs !== undefined) parts.push(formatMinutes(detail.durationMs));
  return parts.length > 0 ? `${head} (${parts.join(', ')})` : head;
}

function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

export function formatInputAlert(pr: Pick<OpenPr, 'repo' | 'number'>, stage: string): string {
  return `${pr.repo} PR #${pr.number} is waiting for input (${stage})`;
}
