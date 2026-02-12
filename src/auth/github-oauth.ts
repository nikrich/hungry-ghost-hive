// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { writeEnvEntries } from './env-store.js';

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_USER_URL = 'https://api.github.com/user';

const DEFAULT_SCOPE = 'repo read:org';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubAuthResult {
  token: string;
  username: string;
}

export interface GitHubDeviceFlowOptions {
  clientId: string;
  scope?: string;
  /** Override for testing: function to POST to GitHub */
  postRequest?: (url: string, body: Record<string, string>) => Promise<Record<string, string>>;
  /** Override for testing: function to GET from GitHub API */
  getRequest?: (url: string, token: string) => Promise<Record<string, unknown>>;
  /** Override for testing: display function */
  displayUserCode?: (userCode: string, verificationUri: string) => void;
  /** Override for testing: sleep function */
  sleepFn?: (ms: number) => Promise<void>;
  /** Root dir for storing env (for testing) */
  rootDir?: string;
}

/**
 * Perform an HTTP POST with form-encoded body, returning JSON.
 */
async function defaultPostRequest(
  url: string,
  body: Record<string, string>
): Promise<Record<string, string>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as Record<string, string>;
}

/**
 * Perform an HTTP GET with auth header, returning JSON.
 */
async function defaultGetRequest(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Default display function for the user code and verification URI.
 */
function defaultDisplayUserCode(userCode: string, verificationUri: string): void {
  console.log();
  console.log(chalk.bold('GitHub Device Authorization'));
  console.log();
  console.log(`  Open this URL in your browser: ${chalk.cyan(verificationUri)}`);
  console.log(`  Enter this code: ${chalk.bold.yellow(userCode)}`);
  console.log();
}

/**
 * Step 1: Request a device code from GitHub.
 */
export async function requestDeviceCode(
  clientId: string,
  scope: string,
  postRequest = defaultPostRequest
): Promise<DeviceCodeResponse> {
  const data = await postRequest(GITHUB_DEVICE_CODE_URL, {
    client_id: clientId,
    scope,
  });

  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('Invalid device code response from GitHub');
  }

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: parseInt(data.expires_in, 10) || 900,
    interval: parseInt(data.interval, 10) || 5,
  };
}

/**
 * Step 2: Poll for the access token until the user authorizes.
 */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
  postRequest = defaultPostRequest,
  sleepFn = sleep
): Promise<GitHubTokenResponse> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    await sleepFn(pollInterval);

    const data = await postRequest(GITHUB_ACCESS_TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) {
      return {
        access_token: data.access_token,
        token_type: data.token_type || 'bearer',
        scope: data.scope || '',
      };
    }

    if (data.error === 'authorization_pending') {
      continue;
    }

    if (data.error === 'slow_down') {
      // GitHub asks us to increase interval by 5 seconds
      pollInterval += 5000;
      continue;
    }

    if (data.error === 'expired_token') {
      throw new Error('Device code expired. Please restart the authentication flow.');
    }

    if (data.error === 'access_denied') {
      throw new Error('Authorization was denied by the user.');
    }

    throw new Error(`Unexpected OAuth error: ${data.error || 'unknown'}`);
  }

  throw new Error('Device code expired. Please restart the authentication flow.');
}

/**
 * Step 3: Fetch the authenticated user's username.
 */
export async function fetchGitHubUsername(
  token: string,
  getRequest = defaultGetRequest
): Promise<string> {
  const data = await getRequest(GITHUB_API_USER_URL, token);
  const login = data.login;
  if (typeof login !== 'string' || !login) {
    throw new Error('Failed to retrieve GitHub username');
  }
  return login;
}

/**
 * Run the full GitHub Device Flow: request code, display to user, poll for token,
 * fetch username, and store credentials in .env.
 */
export async function runGitHubDeviceFlow(
  options: GitHubDeviceFlowOptions
): Promise<GitHubAuthResult> {
  const scope = options.scope ?? DEFAULT_SCOPE;
  const postRequest = options.postRequest ?? defaultPostRequest;
  const getRequest = options.getRequest ?? defaultGetRequest;
  const displayUserCode = options.displayUserCode ?? defaultDisplayUserCode;
  const sleepFn = options.sleepFn ?? sleep;

  // Step 1: Request device code
  const deviceCode = await requestDeviceCode(options.clientId, scope, postRequest);

  // Step 2: Display code to user
  displayUserCode(deviceCode.user_code, deviceCode.verification_uri);

  // Step 3: Poll for token
  const tokenResponse = await pollForToken(
    options.clientId,
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in,
    postRequest,
    sleepFn
  );

  // Step 4: Fetch username
  const username = await fetchGitHubUsername(tokenResponse.access_token, getRequest);

  // Step 5: Store in .env
  writeEnvEntries(
    {
      GITHUB_TOKEN: tokenResponse.access_token,
      GITHUB_USERNAME: username,
    },
    options.rootDir
  );

  return {
    token: tokenResponse.access_token,
    username,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
