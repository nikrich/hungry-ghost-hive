// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { TokenStore } from '../../auth/token-store.js';
import { autoRefreshToken } from '../../auth/jira-oauth.js';
import { OperationalError } from '../../errors/index.js';
import * as logger from '../../utils/logger.js';

/** Options for constructing a JiraClient */
export interface JiraClientOptions {
  tokenStore: TokenStore;
  clientId: string;
  clientSecret: string;
  /** Maximum retries for rate-limited (429) requests. Default: 3 */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 1000 */
  baseDelayMs?: number;
}

/** Error thrown for Jira API failures */
export class JiraApiError extends OperationalError {
  public readonly statusCode: number;
  public readonly responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, JiraApiError.prototype);
  }
}

/**
 * HTTP client for the Jira REST API v3.
 *
 * Handles Bearer auth via TokenStore, automatic token refresh on 401,
 * and exponential-backoff retry on 429 rate limits.
 */
export class JiraClient {
  private readonly tokenStore: TokenStore;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(options: JiraClientOptions) {
    this.tokenStore = options.tokenStore;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
  }

  /**
   * Build the base URL for Jira REST API v3 requests.
   * Uses the cloud ID stored in TokenStore.
   */
  getBaseUrl(): string {
    const cloudId = this.tokenStore.getToken('jira_cloud_id');
    if (!cloudId) {
      throw new OperationalError('No Jira cloud ID configured. Run the Jira OAuth flow first.');
    }
    return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  }

  /**
   * Build the base URL for Jira Agile REST API requests.
   */
  getAgileBaseUrl(): string {
    const cloudId = this.tokenStore.getToken('jira_cloud_id');
    if (!cloudId) {
      throw new OperationalError('No Jira cloud ID configured. Run the Jira OAuth flow first.');
    }
    return `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0`;
  }

  /**
   * Perform an authenticated request to the Jira API.
   * Automatically refreshes the access token on 401 and retries on 429.
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    return this.executeWithRetry<T>(path, options, 0, false);
  }

  /**
   * Internal: execute request with retry logic for 401 and 429 responses.
   */
  private async executeWithRetry<T>(
    path: string,
    options: RequestInit,
    attempt: number,
    tokenRefreshed: boolean
  ): Promise<T> {
    const accessToken = this.tokenStore.getToken('jira_access');
    if (!accessToken) {
      throw new OperationalError('No Jira access token available. Run the Jira OAuth flow first.');
    }

    const url = path.startsWith('http') ? path : `${this.getBaseUrl()}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // 401 Unauthorized — attempt one token refresh
    if (response.status === 401 && !tokenRefreshed) {
      logger.debug('Jira API returned 401, refreshing access token');
      await autoRefreshToken(this.tokenStore, this.clientId, this.clientSecret);
      return this.executeWithRetry<T>(path, options, attempt, true);
    }

    // 429 Rate Limited — retry with exponential backoff
    if (response.status === 429 && attempt < this.maxRetries) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : this.baseDelayMs * Math.pow(2, attempt);
      logger.warn(`Jira API rate limited (429). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${this.maxRetries})`);
      await sleep(delayMs);
      return this.executeWithRetry<T>(path, options, attempt + 1, tokenRefreshed);
    }

    // 204 No Content — return empty
    if (response.status === 204) {
      return undefined as T;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new JiraApiError(
        `Jira API request failed: ${options.method ?? 'GET'} ${path} (${response.status})`,
        response.status,
        body
      );
    }

    // Handle empty response bodies (e.g., 201 with no content from issueLink)
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

/** Promise-based sleep utility */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
