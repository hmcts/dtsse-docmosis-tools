import * as vscode from 'vscode';

export interface WebviewPage {
  title: string;
  /** File names in `dist`. */
  script: string;
  styles: string[];
  /** Directives replacing the defaults, such as `style-src`. */
  csp?: Record<string, string>;
  bodyClass?: string;
}

/** A page that runs only its bundled script, through a nonce, and loads nothing from outside the extension. */
export function webviewHtml(webview: vscode.Webview, dist: vscode.Uri, page: WebviewPage): string {
  const nonce = randomNonce();
  const uri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, file));
  const directives: Record<string, string> = {
    'default-src': "'none'",
    'style-src': webview.cspSource,
    'script-src': `'nonce-${nonce}'`,
    'worker-src': 'blob:',
    'connect-src': webview.cspSource,
    'img-src': `${webview.cspSource} data: blob:`,
    'font-src': `${webview.cspSource} data: blob:`,
    ...page.csp,
  };
  const csp = Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ');
  const styles = page.styles.map((file) => `<link rel="stylesheet" href="${uri(file)}">`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${styles}
<title>${page.title}</title>
</head>
<body${page.bodyClass ? ` class="${page.bodyClass}"` : ''}>
<div id="app"></div>
<script nonce="${nonce}" src="${uri(page.script)}"></script>
</body>
</html>`;
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
