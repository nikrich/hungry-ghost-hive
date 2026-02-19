// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execFile } from 'child_process';

/**
 * Open a URL in the user's default browser, or a specific browser if the
 * BROWSER environment variable is set (e.g. BROWSER="Google Chrome" on macOS).
 * Falls back silently if the browser cannot be opened.
 */
export async function openBrowser(url: string): Promise<void> {
  const browserEnv = process.env.BROWSER;

  let bin: string;
  let args: string[];

  if (process.platform === 'darwin') {
    if (browserEnv) {
      bin = 'open';
      args = ['-a', browserEnv, url];
    } else {
      bin = 'open';
      args = [url];
    }
  } else if (process.platform === 'win32') {
    bin = 'cmd';
    args = browserEnv ? ['/c', 'start', '', browserEnv, url] : ['/c', 'start', '', url];
  } else {
    bin = browserEnv ?? 'xdg-open';
    args = [url];
  }

  return new Promise(resolve => {
    execFile(bin, args, err => {
      if (err) {
        console.warn(`Could not open browser automatically. Please open the URL manually.`);
      }
      resolve();
    });
  });
}
