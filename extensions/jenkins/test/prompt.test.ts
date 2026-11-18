import { describe, expect, it } from 'vitest';
import { renderPrompt, terminalName } from '../src/core/prompt';

const TEMPLATE =
  "Investigate the failed Jenkins build {buildUrl}. Repo {repo} (local clone {clonePath}), {pr} branch {branch}, commit {commit}. Failed stage: {failedStage}. Use the Jenkins MCP. Don't push.";

const full = {
  buildUrl: 'https://b/job/x/7/',
  repo: 'pcs-api',
  clonePath: '/w/apps/pcs/pcs-api',
  pr: 'PR #123',
  branch: 'feat/x',
  commit: 'abc123',
  failedStage: 'Functional tests',
};

describe('renderPrompt', () => {
  it('fills every placeholder', () => {
    expect(renderPrompt(TEMPLATE, full)).toBe(
      "Investigate the failed Jenkins build https://b/job/x/7/. Repo pcs-api (local clone /w/apps/pcs/pcs-api), PR #123 branch feat/x, commit abc123. Failed stage: Functional tests. Use the Jenkins MCP. Don't push.",
    );
  });

  it('drops clauses and parentheticals whose placeholders are empty', () => {
    expect(
      renderPrompt(TEMPLATE, { ...full, clonePath: '', pr: '', branch: '', commit: '', failedStage: '' }),
    ).toBe(
      "Investigate the failed Jenkins build https://b/job/x/7/. Repo pcs-api. Use the Jenkins MCP. Don't push.",
    );
  });

  it('keeps a clause with at least one value and tidies spacing', () => {
    expect(renderPrompt(TEMPLATE, { ...full, pr: '' })).toContain(
      'Repo pcs-api (local clone /w/apps/pcs/pcs-api), branch feat/x, commit abc123.',
    );
  });

  it('keeps a parenthetical with a value and leaves unknown placeholders', () => {
    expect(renderPrompt('Do {unknown} for {repo} ({commit}) now', full)).toBe(
      'Do {unknown} for pcs-api (abc123) now',
    );
  });
});

describe('terminalName', () => {
  it('names the terminal', () =>
    expect(terminalName('pcs-api', 'PR-123', 7)).toBe('Claude: pcs-api PR-123 #7'));
});
