import { describe, expect, it } from 'vitest';
import {
  type AlertState,
  anyPending,
  EMPTY_ALERT_STATE,
  evaluate,
  formatAlert,
  formatInputAlert,
  jenkinsStatusOf,
  markInput,
  prKey,
} from '../src/core/alerts';
import type { OpenPr, PrStatus } from '../src/core/github';

const status = (
  state: PrStatus['state'],
  context = 'continuous-integration/jenkins/pr-head',
  targetUrl: string | null = 'https://b/job/x/1/',
): PrStatus => ({
  context,
  state,
  targetUrl,
});

const pr = (statuses: PrStatus[], sha = 'sha1', number = 123): OpenPr => ({
  slug: 'hmcts/pcs-api',
  repo: 'pcs-api',
  number,
  title: 't',
  url: 'u',
  headSha: sha,
  headRef: 'r',
  statuses,
});

describe('jenkinsStatusOf', () => {
  it('ignores non-Jenkins statuses', () => {
    expect(jenkinsStatusOf([status('SUCCESS', 'sonar')])).toBeUndefined();
    expect(jenkinsStatusOf([])).toBeUndefined();
  });
  it('maps every GitHub state', () => {
    expect(jenkinsStatusOf([status('PENDING')])?.state).toBe('pending');
    expect(jenkinsStatusOf([status('EXPECTED')])?.state).toBe('pending');
    expect(jenkinsStatusOf([status('SUCCESS')])?.state).toBe('success');
    expect(jenkinsStatusOf([status('FAILURE')])?.state).toBe('failure');
    expect(jenkinsStatusOf([status('ERROR')])?.state).toBe('error');
  });
  it('prefers pr-head and keeps the target url when present', () => {
    const result = jenkinsStatusOf([
      status('FAILURE', 'continuous-integration/jenkins/pr-merge', 'm'),
      status('SUCCESS', 'Jenkins pr-head', 'h'),
    ]);
    expect(result).toEqual({ state: 'success', targetUrl: 'h' });
    expect(jenkinsStatusOf([status('SUCCESS', 'jenkins', null)])).toEqual({ state: 'success' });
  });
});

describe('anyPending / prKey', () => {
  it('detects pending Jenkins builds', () => {
    expect(anyPending([pr([status('SUCCESS')]), pr([status('PENDING')])])).toBe(true);
    expect(anyPending([pr([status('SUCCESS')]), pr([])])).toBe(false);
  });
  it('keys by slug and number', () => expect(prKey(pr([]))).toBe('hmcts/pcs-api#123'));
});

describe('evaluate', () => {
  it('sets a baseline without alerting for PRs seen first time', () => {
    const { next, events } = evaluate(EMPTY_ALERT_STATE, [
      pr([status('FAILURE')]),
      pr([status('PENDING')], 's', 2),
      pr([]),
    ]);
    expect(events).toEqual([]);
    expect(next.prs['hmcts/pcs-api#123']).toEqual({ sha: 'sha1', state: 'failure' });
    expect(next.prs['hmcts/pcs-api#2']).toEqual({ sha: 's', state: 'pending' });
    expect(Object.keys(next.prs)).toHaveLength(2);
  });

  it('alerts on pending to finished, with the target url', () => {
    const previous: AlertState = {
      prs: { 'hmcts/pcs-api#123': { sha: 'sha1', state: 'pending' } },
      inputs: ['i'],
    };
    const { next, events } = evaluate(previous, [pr([status('FAILURE')])]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ state: 'failure', targetUrl: 'https://b/job/x/1/' });
    expect(next.inputs).toEqual(['i']);
    expect(evaluate(next, [pr([status('FAILURE')])]).events).toEqual([]);
  });

  it('alerts without a target url when there is none', () => {
    const previous: AlertState = {
      prs: { 'hmcts/pcs-api#123': { sha: 'sha1', state: 'pending' } },
      inputs: [],
    };
    const { events } = evaluate(previous, [pr([status('SUCCESS', undefined, null)])]);
    expect(events).toHaveLength(1);
    expect(events[0]?.targetUrl).toBeUndefined();
  });

  it('alerts when a new head commit finished between polls', () => {
    const previous: AlertState = {
      prs: { 'hmcts/pcs-api#123': { sha: 'old', state: 'success' } },
      inputs: [],
    };
    expect(evaluate(previous, [pr([status('SUCCESS')], 'new')]).events).toHaveLength(1);
  });

  it('does not alert while still pending', () => {
    const previous: AlertState = {
      prs: { 'hmcts/pcs-api#123': { sha: 'sha1', state: 'pending' } },
      inputs: [],
    };
    expect(evaluate(previous, [pr([status('PENDING')])]).events).toEqual([]);
  });

  it('forgets PRs that are no longer open', () => {
    const previous: AlertState = { prs: { 'hmcts/pcs-api#9': { sha: 's', state: 'pending' } }, inputs: [] };
    expect(evaluate(previous, []).next.prs).toEqual({});
  });
});

describe('markInput', () => {
  it('records a build once and caps the list', () => {
    const first = markInput(EMPTY_ALERT_STATE, 'b1');
    expect(first).toEqual({ state: { prs: {}, inputs: ['b1'] }, isNew: true });
    expect(markInput(first.state, 'b1')).toEqual({ state: first.state, isNew: false });
    let state = EMPTY_ALERT_STATE;
    for (let i = 0; i < 120; i++) state = markInput(state, `b${i}`).state;
    expect(state.inputs).toHaveLength(100);
    expect(state.inputs.at(-1)).toBe('b119');
  });
});

describe('formatAlert', () => {
  const event = (state: 'success' | 'failure' | 'error') => ({ pr: pr([]), state });
  it('formats with stage and duration', () => {
    expect(formatAlert(event('failure'), { failedStage: 'Functional tests', durationMs: 14 * 60_000 })).toBe(
      'pcs-api PR #123 failed (Functional tests, 14m)',
    );
  });
  it('formats each verb and omits missing detail', () => {
    expect(formatAlert(event('success'))).toBe('pcs-api PR #123 passed');
    expect(formatAlert(event('error'), { durationMs: 20_000 })).toBe('pcs-api PR #123 errored (20s)');
    expect(formatAlert(event('success'), { durationMs: 3_600_000 })).toBe('pcs-api PR #123 passed (1h)');
    expect(formatAlert(event('success'), { durationMs: 4_500_000 })).toBe('pcs-api PR #123 passed (1h 15m)');
    expect(formatAlert(event('failure'), { failedStage: 'Build' })).toBe('pcs-api PR #123 failed (Build)');
  });
  it('formats input alerts', () => {
    expect(formatInputAlert({ repo: 'pcs-api', number: 4 }, 'Deploy?')).toBe(
      'pcs-api PR #4 is waiting for input (Deploy?)',
    );
  });
});
