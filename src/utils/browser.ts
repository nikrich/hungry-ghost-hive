// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execa } from 'execa';

/**
 * Open a URL in the default browser.
 * Works on macOS, Windows, and Linux.
 */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      // macOS
      await execa('open', [url]);
    } else if (platform === 'win32') {
      // Windows
      await execa('cmd', ['/c', 'start', url]);
    } else {
      // Linux and other platforms
      await execa('xdg-open', [url]);
    }
  } catch (err) {
    // If opening the browser fails, silently continue
    // The user will still see the URL printed to the terminal
  }
}
