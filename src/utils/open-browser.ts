// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { exec } from 'child_process';

/**
 * Open a URL in the user's default browser.
 * Falls back silently if the browser cannot be opened.
 */
export async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';

  return new Promise((resolve) => {
    exec(`${command} "${url}"`, (err) => {
      if (err) {
        // Don't throw - caller should print the URL as fallback
        console.warn(`Could not open browser automatically. Please open the URL manually.`);
      }
      resolve();
    });
  });
}
