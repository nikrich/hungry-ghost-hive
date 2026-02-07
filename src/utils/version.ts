import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

let cachedVersion: string | null = null;

export function getVersion(): string {
  // Return cached version if available
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Try to read package.json from multiple possible locations
    const possiblePaths = [
      join(__dirname, '../../package.json'), // For compiled dist/utils/version.js
      join(__dirname, '../../../package.json'), // Fallback for nested builds
      join(process.cwd(), 'package.json'), // Current working directory fallback
    ];

    for (const packageJsonPath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.version) {
          cachedVersion = packageJson.version as string;
          return cachedVersion!;
        }
      } catch (_error) {
        // Try next path
        continue;
      }
    }

    // Fallback version
    cachedVersion = '0.0.0';
    return cachedVersion;
  } catch (_error) {
    cachedVersion = '0.0.0';
    return cachedVersion;
  }
}
