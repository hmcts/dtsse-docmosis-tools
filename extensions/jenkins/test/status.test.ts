import { describe, expect, it } from 'vitest';
import { iconFor, statusFromBuild, statusFromColor, statusFromStage, statusWord } from '../src/core/status';

describe('status', () => {
  it.each([
    [undefined, 'notbuilt'],
    ['blue', 'success'],
    ['red', 'failure'],
    ['yellow', 'unstable'],
    ['aborted', 'aborted'],
    ['notbuilt', 'notbuilt'],
    ['disabled', 'notbuilt'],
    ['blue_anime', 'running'],
  ])('maps colour %s to %s', (color, status) => expect(statusFromColor(color)).toBe(status));

  it.each([
    [undefined, 'notbuilt'],
    [{ building: true }, 'running'],
    [{ result: 'SUCCESS' }, 'success'],
    [{ result: 'FAILURE' }, 'failure'],
    [{ result: 'UNSTABLE' }, 'unstable'],
    [{ result: 'ABORTED' }, 'aborted'],
    [{ result: null }, 'notbuilt'],
  ])('maps build %j to %s', (build, status) => expect(statusFromBuild(build)).toBe(status));

  it.each([
    ['SUCCESS', 'success'],
    ['FAILED', 'failure'],
    ['UNSTABLE', 'unstable'],
    ['ABORTED', 'aborted'],
    ['IN_PROGRESS', 'running'],
    ['PAUSED_PENDING_INPUT', 'running'],
    ['NOT_EXECUTED', 'notbuilt'],
    [undefined, 'notbuilt'],
  ])('maps stage %s to %s', (stage, status) => expect(statusFromStage(stage)).toBe(status));

  it('has an icon and a word for every status', () => {
    for (const status of ['success', 'failure', 'unstable', 'aborted', 'running', 'notbuilt'] as const) {
      expect(iconFor(status).id).toBeTruthy();
      expect(statusWord(status)).toBeTruthy();
    }
    expect(statusWord('notbuilt')).toBe('not built');
  });
});
