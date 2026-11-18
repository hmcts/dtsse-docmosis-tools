import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { credentialsFromEnv, type JenkinsCredentials, parseEnvFile } from '../core/envFile';
import { DEFAULT_JENKINS_URL } from '../core/jenkinsPaths';

const KEYS = { url: 'dtsseJenkins.url', username: 'dtsseJenkins.username', token: 'dtsseJenkins.token' };

export async function loadCredentials(
  root: string | undefined,
  secrets: vscode.SecretStorage,
): Promise<(JenkinsCredentials & { url: string }) | undefined> {
  if (root) {
    try {
      const fromFile = credentialsFromEnv(
        parseEnvFile(readFileSync(join(root, '.claude', '.jenkins.env'), 'utf8')),
      );
      if (fromFile) return { ...fromFile, url: fromFile.url ?? DEFAULT_JENKINS_URL };
    } catch {
      // No env file: fall back to stored credentials.
    }
  }
  const [url, username, token] = await Promise.all([
    secrets.get(KEYS.url),
    secrets.get(KEYS.username),
    secrets.get(KEYS.token),
  ]);
  return username && token ? { url: url || DEFAULT_JENKINS_URL, username, token } : undefined;
}

export async function promptForCredentials(secrets: vscode.SecretStorage): Promise<boolean> {
  const url = await vscode.window.showInputBox({
    title: 'Jenkins URL',
    value: (await secrets.get(KEYS.url)) ?? DEFAULT_JENKINS_URL,
    ignoreFocusOut: true,
  });
  if (!url) return false;
  const username = await vscode.window.showInputBox({
    title: 'Jenkins username',
    value: await secrets.get(KEYS.username),
    ignoreFocusOut: true,
  });
  if (!username) return false;
  const token = await vscode.window.showInputBox({
    title: 'Jenkins API token',
    prompt: 'Create one under your Jenkins user > Configure > API Token',
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) return false;
  await secrets.store(KEYS.url, url);
  await secrets.store(KEYS.username, username);
  await secrets.store(KEYS.token, token);
  return true;
}
