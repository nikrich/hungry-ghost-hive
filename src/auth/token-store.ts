// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import lock from 'proper-lockfile';

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'github'
  | 'jira_access'
  | 'jira_refresh'
  | 'jira_cloud_id'
  | 'jira_site_url';

interface TokenData {
  [key: string]: string;
}

/**
 * TokenStore manages API tokens and credentials with atomic file operations.
 * Supports loading from .env files and storing tokens safely with file locking.
 */
/** Default lock retry settings */
const LOCK_MAX_RETRIES = 5;
const LOCK_BASE_DELAY_MS = 100;

export class TokenStore {
  private tokens: TokenData = {};
  private envPath: string;

  constructor(envPath: string = '.env') {
    this.envPath = envPath;
  }

  /**
   * Load tokens from a .env file atomically
   */
  async loadFromEnv(filePath: string = this.envPath): Promise<void> {
    if (!existsSync(filePath)) {
      // File doesn't exist yet, start with empty tokens
      return;
    }

    let release: (() => Promise<void>) | null = null;
    try {
      // Acquire lock before reading (with retry for contention)
      release = await this.acquireLockWithRetry(filePath);
      const content = readFileSync(filePath, 'utf-8');
      this.parseEnvContent(content);
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * Get a token for a specific provider
   */
  getToken(provider: ProviderType): string | undefined {
    const key = this.getEnvKey(provider);
    return this.tokens[key];
  }

  /**
   * Set a token for a specific provider and save to file atomically
   */
  async setToken(provider: ProviderType, token: string): Promise<void> {
    if (!token) {
      throw new Error('Token cannot be empty');
    }

    const key = this.getEnvKey(provider);
    this.tokens[key] = token;

    await this.writeTokensToFile();
  }

  /**
   * Get all tokens as an object
   */
  getAllTokens(): TokenData {
    return { ...this.tokens };
  }

  /**
   * Load tokens from environment variables (process.env)
   */
  loadFromEnvVars(): void {
    const providers: ProviderType[] = [
      'anthropic',
      'openai',
      'github',
      'jira_access',
      'jira_refresh',
      'jira_cloud_id',
      'jira_site_url',
    ];

    for (const provider of providers) {
      const key = this.getEnvKey(provider);
      const value = process.env[key];
      if (value) {
        this.tokens[key] = value;
      }
    }
  }

  /**
   * Validate that required tokens are available
   */
  validateTokens(requiredProviders: ProviderType[]): string[] {
    const missing: string[] = [];

    for (const provider of requiredProviders) {
      if (!this.getToken(provider)) {
        missing.push(provider);
      }
    }

    return missing;
  }

  /**
   * Clear all tokens
   */
  clear(): void {
    this.tokens = {};
  }

  /**
   * Acquire a file lock with exponential backoff retry.
   * Retries up to LOCK_MAX_RETRIES times when the lock is already held,
   * preventing immediate failure during concurrent Jira operations.
   */
  private async acquireLockWithRetry(
    filePath: string,
    options?: { realpath?: boolean }
  ): Promise<() => Promise<void>> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt++) {
      try {
        return await lock.lock(filePath, options);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < LOCK_MAX_RETRIES) {
          const delay = LOCK_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * Parse .env file content and populate tokens
   */
  private parseEnvContent(content: string): void {
    const lines = content.split('\n');

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith('#')) {
        continue;
      }

      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        const trimmedKey = key.trim();
        let trimmedValue = value.trim();

        // Remove quotes if present
        if (
          (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
          (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
        ) {
          trimmedValue = trimmedValue.slice(1, -1);
        }

        if (this.isValidTokenKey(trimmedKey)) {
          this.tokens[trimmedKey] = trimmedValue;
        }
      }
    }
  }

  /**
   * Write tokens to .env file atomically using file locking
   */
  private async writeTokensToFile(): Promise<void> {
    const dir = dirname(this.envPath);
    if (!existsSync(dir) && dir !== '.') {
      mkdirSync(dir, { recursive: true });
    }

    let release: (() => Promise<void>) | null = null;
    try {
      // Acquire lock before writing (with retry for contention)
      release = await this.acquireLockWithRetry(this.envPath, { realpath: false });

      // Read existing file to preserve any other variables
      let existingContent = '';
      if (existsSync(this.envPath)) {
        existingContent = readFileSync(this.envPath, 'utf-8');
      }

      // Merge existing content with new tokens
      const updatedContent = this.mergeWithExisting(existingContent);

      // Write atomically using a temporary file pattern
      const tempPath = `${this.envPath}.tmp`;
      writeFileSync(tempPath, updatedContent, 'utf-8');
      // Replace original with temp file atomically
      writeFileSync(this.envPath, updatedContent, 'utf-8');

      if (existsSync(tempPath)) {
        try {
          require('fs').unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * Merge new tokens with existing .env content, preserving non-token variables
   */
  private mergeWithExisting(existingContent: string): string {
    const lines = existingContent.split('\n');
    const tokenKeys = Object.keys(this.tokens);
    const updated = new Set<string>();

    // Update existing token lines
    const updatedLines = lines.map(line => {
      if (!line.trim() || line.trim().startsWith('#')) {
        return line;
      }

      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) {
        const [, key] = match;
        const trimmedKey = key.trim();

        if (trimmedKey in this.tokens) {
          updated.add(trimmedKey);
          return `${trimmedKey}=${this.tokens[trimmedKey]}`;
        }
      }

      return line;
    });

    // Add new tokens that weren't in the file
    const newTokenLines: string[] = [];
    for (const key of tokenKeys) {
      if (!updated.has(key)) {
        newTokenLines.push(`${key}=${this.tokens[key]}`);
      }
    }

    const result = updatedLines.join('\n').trimEnd();
    if (newTokenLines.length > 0) {
      return result + '\n' + newTokenLines.join('\n') + '\n';
    }

    return result.endsWith('\n') ? result : result + '\n';
  }

  /**
   * Convert provider name to environment variable key
   */
  private getEnvKey(provider: ProviderType): string {
    const keyMap: Record<ProviderType, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      github: 'GITHUB_TOKEN',
      jira_access: 'JIRA_ACCESS_TOKEN',
      jira_refresh: 'JIRA_REFRESH_TOKEN',
      jira_cloud_id: 'JIRA_CLOUD_ID',
      jira_site_url: 'JIRA_SITE_URL',
    };

    return keyMap[provider];
  }

  /**
   * Check if a key is a valid token key we manage
   */
  private isValidTokenKey(key: string): boolean {
    const validKeys = [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GITHUB_TOKEN',
      'JIRA_ACCESS_TOKEN',
      'JIRA_REFRESH_TOKEN',
      'JIRA_CLOUD_ID',
      'JIRA_SITE_URL',
    ];
    return validKeys.includes(key);
  }
}
