import { describe, expect, it } from 'vitest';
import { credentialsFromEnv, parseEnvFile } from '../src/core/envFile';

describe('env file', () => {
  it('parses KEY=VALUE lines, skipping comments, blanks and junk', () => {
    expect(
      parseEnvFile(
        '# c\n\nJENKINS_URL=https://x\r\n  JENKINS_USERNAME = me \nnoequals\n=novalue\nTOKEN=a=b\n',
      ),
    ).toEqual({ JENKINS_URL: 'https://x', JENKINS_USERNAME: 'me', TOKEN: 'a=b' });
  });

  it('builds credentials', () => {
    expect(credentialsFromEnv({ JENKINS_USERNAME: 'u', JENKINS_PASSWORD: 't' })).toEqual({
      username: 'u',
      token: 't',
    });
    expect(
      credentialsFromEnv({ JENKINS_URL: 'https://j', JENKINS_USERNAME: 'u', JENKINS_PASSWORD: 't' }),
    ).toEqual({
      url: 'https://j',
      username: 'u',
      token: 't',
    });
    expect(credentialsFromEnv({ JENKINS_USERNAME: 'u' })).toBeUndefined();
    expect(credentialsFromEnv({ JENKINS_PASSWORD: 't' })).toBeUndefined();
  });
});
