export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

export interface JenkinsCredentials {
  url?: string;
  username: string;
  token: string;
}

export function credentialsFromEnv(values: Record<string, string>): JenkinsCredentials | undefined {
  const username = values.JENKINS_USERNAME;
  const token = values.JENKINS_PASSWORD;
  if (!username || !token) return undefined;
  const creds: JenkinsCredentials = { username, token };
  if (values.JENKINS_URL) creds.url = values.JENKINS_URL;
  return creds;
}
