// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { TokenStore } from './token-store.js';

/** Scopes required for Hive's Jira + Confluence integration */
const JIRA_OAUTH_SCOPES = [
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'manage:jira-configuration',
  'read:board-scope:jira-software',
  'write:board-scope.admin:jira-software',
  'offline_access',
  'read:confluence-content.all',
] as const;

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

/** OAuth token response from Atlassian */
export interface JiraTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/** Accessible resource from Atlassian (cloud site) */
export interface AccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl: string;
}

/** Result from completing the OAuth flow */
export interface JiraOAuthResult {
  accessToken: string;
  refreshToken: string;
  cloudId: string;
  siteUrl: string;
  expiresIn: number;
}

/** Options for starting the OAuth flow */
export interface JiraOAuthOptions {
  clientId: string;
  clientSecret: string;
  port?: number;
  openBrowser?: (url: string) => Promise<void>;
  timeoutMs?: number;
}

/**
 * Build the Atlassian OAuth 2.0 authorization URL.
 */
export function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId,
    scope: JIRA_OAUTH_SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  return `${ATLASSIAN_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<JiraTokenResponse> {
  const response = await fetch(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  return (await response.json()) as JiraTokenResponse;
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<JiraTokenResponse> {
  const response = await fetch(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${body}`);
  }

  return (await response.json()) as JiraTokenResponse;
}

/**
 * Fetch accessible Atlassian cloud resources for the authenticated user.
 * Returns the list of sites the user has access to.
 */
export async function fetchAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
  const response = await fetch(ATLASSIAN_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch accessible resources (${response.status}): ${body}`);
  }

  return (await response.json()) as AccessibleResource[];
}

/**
 * Store Jira OAuth tokens in the .env file via TokenStore.
 */
export async function storeJiraTokens(
  tokenStore: TokenStore,
  result: JiraOAuthResult
): Promise<void> {
  await tokenStore.setToken('jira_access', result.accessToken);
  await tokenStore.setToken('jira_refresh', result.refreshToken);
  await tokenStore.setToken('jira_cloud_id', result.cloudId);
  await tokenStore.setToken('jira_site_url', result.siteUrl);
}

/**
 * Auto-refresh Jira access token if a refresh token is available.
 * Returns the new access token, or the existing one if refresh is not needed.
 */
export async function autoRefreshToken(
  tokenStore: TokenStore,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const refreshToken = tokenStore.getToken('jira_refresh');
  if (!refreshToken) {
    throw new Error('No Jira refresh token available. Re-run OAuth flow.');
  }

  const tokens = await refreshAccessToken(refreshToken, clientId, clientSecret);

  await tokenStore.setToken('jira_access', tokens.access_token);
  if (tokens.refresh_token) {
    await tokenStore.setToken('jira_refresh', tokens.refresh_token);
  }

  return tokens.access_token;
}

/**
 * Generate a cryptographically random state parameter for CSRF protection.
 */
function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Start an ephemeral local HTTP server to receive the OAuth callback,
 * open the browser for authorization, exchange the code for tokens,
 * fetch accessible resources, and store everything in .env.
 *
 * Returns the OAuth result with tokens and cloud metadata.
 */
export async function startJiraOAuthFlow(options: JiraOAuthOptions): Promise<JiraOAuthResult> {
  const { clientId, clientSecret, port = 9876, openBrowser, timeoutMs = 300_000 } = options;
  const state = generateState();

  return new Promise<JiraOAuthResult>((resolve, reject) => {
    let settled = false;
    let server: Server | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (server) {
        server.close();
        server = null;
      }
    };

    const settle = (err: Error | null, result?: JiraOAuthResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(result!);
    };

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      handleCallback(req, res, {
        clientId,
        clientSecret,
        state,
        serverPort: (server!.address() as { port: number }).port,
        settle,
      });
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server!.address() as { port: number };
      const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const authUrl = buildAuthorizationUrl(clientId, redirectUri, state);

      // Open browser for authorization
      console.log(`\nOpening browser for Jira authorization...\n\n  ${authUrl}\n`);
      if (openBrowser) {
        openBrowser(authUrl).catch(() => {
          console.log('Could not open browser automatically. Please open the URL above manually.');
        });
      }
    });

    server.on('error', (err: Error) => settle(err));

    timer = setTimeout(
      () => settle(new Error('OAuth flow timed out. No callback received.')),
      timeoutMs
    );
  });
}

/** Internal handler for the OAuth callback request */
async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    clientId: string;
    clientSecret: string;
    state: string;
    serverPort: number;
    settle: (err: Error | null, result?: JiraOAuthResult) => void;
  }
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${ctx.serverPort}`);

  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description') ?? error;
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<html><body><h2>Authorization Failed</h2><p>${desc}</p></body></html>`);
    ctx.settle(new Error(`Jira OAuth error: ${desc}`));
    return;
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code || returnedState !== ctx.state) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(
      '<html><body><h2>Authorization Failed</h2><p>Invalid or missing authorization code.</p></body></html>'
    );
    ctx.settle(new Error('Invalid OAuth callback: missing code or state mismatch'));
    return;
  }

  try {
    const redirectUri = `http://127.0.0.1:${ctx.serverPort}/callback`;
    const tokens = await exchangeCodeForTokens(code, ctx.clientId, ctx.clientSecret, redirectUri);
    const resources = await fetchAccessibleResources(tokens.access_token);

    if (resources.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h2>No Accessible Sites</h2><p>No Jira sites found for this account.</p></body></html>'
      );
      ctx.settle(new Error('No accessible Jira sites found for this account'));
      return;
    }

    // Use the first accessible resource (most common case: single site)
    const site = resources[0];
    const result: JiraOAuthResult = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      cloudId: site.id,
      siteUrl: site.url,
      expiresIn: tokens.expires_in,
    };

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<html><body><h2>Authorization Successful</h2><p>You can close this window and return to the terminal.</p></body></html>'
    );
    ctx.settle(null, result);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(
      '<html><body><h2>Authorization Failed</h2><p>Token exchange failed. Check the terminal for details.</p></body></html>'
    );
    ctx.settle(err instanceof Error ? err : new Error(String(err)));
  }
}
