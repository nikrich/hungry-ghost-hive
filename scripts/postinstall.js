#!/usr/bin/env node

/**
 * Postinstall script that checks if the npm global bin directory
 * is in the user's PATH on Windows. If not, prints a helpful message.
 */

if (process.platform !== 'win32') {
  process.exit(0);
}

import { execSync } from 'child_process';

try {
  // Get npm's global bin directory
  const npmBin = execSync('npm config get prefix', { encoding: 'utf-8' }).trim();
  const envPath = process.env.PATH || process.env.Path || '';

  // On Windows, npm installs binaries to <prefix>/
  // Check both <prefix> and <prefix>/node_modules/.bin
  const pathEntries = envPath.split(';').map(p => p.toLowerCase().replace(/\\/g, '/'));
  const npmBinNorm = npmBin.toLowerCase().replace(/\\/g, '/');

  const inPath = pathEntries.some(p => p === npmBinNorm || p === npmBinNorm + '/');

  if (!inPath) {
    console.log('');
    console.log('\x1b[33m%s\x1b[0m', '  ⚠ Hive CLI: npm global bin directory is not in your PATH');
    console.log('');
    console.log('  To use the "hive" command, add this directory to your PATH:');
    console.log('');
    console.log('\x1b[36m%s\x1b[0m', `    ${npmBin}`);
    console.log('');
    console.log('  You can do this by running (PowerShell as Administrator):');
    console.log('');
    console.log(
      '\x1b[36m%s\x1b[0m',
      `    [Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";${npmBin}", "User")`
    );
    console.log('');
    console.log('  Then restart your terminal.');
    console.log('');
  }
} catch {
  // Silently ignore errors - this is just a helpful hint
}
