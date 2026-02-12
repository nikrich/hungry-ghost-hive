// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEnvFile } from './env-store.js';
import {
  fetchGitHubUsername,
  pollForToken,
  requestDeviceCode,
  runGitHubDeviceFlow,
} from './github-oauth.js';

const noopSleep = () => Promise.resolve();

describe('github-oauth', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-oauth-test-'));
    mkdirSync(join(tempDir, '.hive'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('requestDeviceCode', () => {
    it('should request a device code from GitHub', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        device_code: 'dc_test123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: '900',
        interval: '5',
      });

      const result = await requestDeviceCode('test-client-id', 'repo', mockPost);

      expect(result).toEqual({
        device_code: 'dc_test123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });

      expect(mockPost).toHaveBeenCalledWith('https://github.com/login/device/code', {
        client_id: 'test-client-id',
        scope: 'repo',
      });
    });

    it('should throw on invalid response', async () => {
      const mockPost = vi.fn().mockResolvedValue({});

      await expect(requestDeviceCode('test-id', 'repo', mockPost)).rejects.toThrow(
        'Invalid device code response'
      );
    });

    it('should use default values for missing expires_in and interval', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        device_code: 'dc_test',
        user_code: 'WXYZ-5678',
        verification_uri: 'https://github.com/login/device',
      });

      const result = await requestDeviceCode('test-id', 'repo', mockPost);
      expect(result.expires_in).toBe(900);
      expect(result.interval).toBe(5);
    });
  });

  describe('pollForToken', () => {
    it('should return token on successful authorization', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        access_token: 'ghp_token123',
        token_type: 'bearer',
        scope: 'repo',
      });

      const result = await pollForToken('client-id', 'device-code', 1, 10, mockPost, noopSleep);

      expect(result).toEqual({
        access_token: 'ghp_token123',
        token_type: 'bearer',
        scope: 'repo',
      });
    });

    it('should retry on authorization_pending', async () => {
      const mockPost = vi
        .fn()
        .mockResolvedValueOnce({ error: 'authorization_pending' })
        .mockResolvedValueOnce({
          access_token: 'ghp_token456',
          token_type: 'bearer',
          scope: 'repo',
        });

      const result = await pollForToken('client-id', 'device-code', 1, 10, mockPost, noopSleep);

      expect(result.access_token).toBe('ghp_token456');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should throw on access_denied', async () => {
      const mockPost = vi.fn().mockResolvedValue({ error: 'access_denied' });

      await expect(
        pollForToken('client-id', 'device-code', 1, 10, mockPost, noopSleep)
      ).rejects.toThrow('Authorization was denied');
    });

    it('should throw on expired_token', async () => {
      const mockPost = vi.fn().mockResolvedValue({ error: 'expired_token' });

      await expect(
        pollForToken('client-id', 'device-code', 1, 10, mockPost, noopSleep)
      ).rejects.toThrow('Device code expired');
    });

    it('should throw on unknown error', async () => {
      const mockPost = vi.fn().mockResolvedValue({ error: 'some_unknown_error' });

      await expect(
        pollForToken('client-id', 'device-code', 1, 10, mockPost, noopSleep)
      ).rejects.toThrow('Unexpected OAuth error: some_unknown_error');
    });

    it('should increase interval on slow_down', async () => {
      const mockPost = vi.fn().mockResolvedValueOnce({ error: 'slow_down' }).mockResolvedValueOnce({
        access_token: 'ghp_token789',
        token_type: 'bearer',
        scope: 'repo',
      });

      const result = await pollForToken('client-id', 'device-code', 1, 30, mockPost, noopSleep);

      expect(result.access_token).toBe('ghp_token789');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchGitHubUsername', () => {
    it('should return the username from GitHub API', async () => {
      const mockGet = vi.fn().mockResolvedValue({ login: 'testuser' });

      const username = await fetchGitHubUsername('ghp_token123', mockGet);

      expect(username).toBe('testuser');
      expect(mockGet).toHaveBeenCalledWith('https://api.github.com/user', 'ghp_token123');
    });

    it('should throw if login is missing', async () => {
      const mockGet = vi.fn().mockResolvedValue({});

      await expect(fetchGitHubUsername('ghp_token', mockGet)).rejects.toThrow(
        'Failed to retrieve GitHub username'
      );
    });

    it('should throw if login is not a string', async () => {
      const mockGet = vi.fn().mockResolvedValue({ login: 42 });

      await expect(fetchGitHubUsername('ghp_token', mockGet)).rejects.toThrow(
        'Failed to retrieve GitHub username'
      );
    });
  });

  describe('runGitHubDeviceFlow', () => {
    it('should complete the full device flow and store credentials', async () => {
      const mockPost = vi
        .fn()
        .mockResolvedValueOnce({
          device_code: 'dc_full_test',
          user_code: 'FULL-TEST',
          verification_uri: 'https://github.com/login/device',
          expires_in: '900',
          interval: '1',
        })
        .mockResolvedValueOnce({
          access_token: 'ghp_full_token',
          token_type: 'bearer',
          scope: 'repo read:org',
        });

      const mockGet = vi.fn().mockResolvedValue({ login: 'fulluser' });
      const mockDisplay = vi.fn();

      const result = await runGitHubDeviceFlow({
        clientId: 'test-client',
        postRequest: mockPost,
        getRequest: mockGet,
        displayUserCode: mockDisplay,
        sleepFn: noopSleep,
        rootDir: tempDir,
      });

      expect(result).toEqual({
        token: 'ghp_full_token',
        username: 'fulluser',
      });

      // Verify display was called
      expect(mockDisplay).toHaveBeenCalledWith('FULL-TEST', 'https://github.com/login/device');

      // Verify credentials were stored in .env
      const envEntries = readEnvFile(tempDir);
      expect(envEntries.GITHUB_TOKEN).toBe('ghp_full_token');
      expect(envEntries.GITHUB_USERNAME).toBe('fulluser');
    });

    it('should use default scope when not specified', async () => {
      const mockPost = vi
        .fn()
        .mockResolvedValueOnce({
          device_code: 'dc_scope_test',
          user_code: 'SCOPE-TEST',
          verification_uri: 'https://github.com/login/device',
          expires_in: '900',
          interval: '1',
        })
        .mockResolvedValueOnce({
          access_token: 'ghp_scope_token',
          token_type: 'bearer',
          scope: 'repo read:org',
        });

      const mockGet = vi.fn().mockResolvedValue({ login: 'scopeuser' });

      await runGitHubDeviceFlow({
        clientId: 'test-client',
        postRequest: mockPost,
        getRequest: mockGet,
        displayUserCode: vi.fn(),
        sleepFn: noopSleep,
        rootDir: tempDir,
      });

      // Verify default scope was used
      expect(mockPost).toHaveBeenCalledWith('https://github.com/login/device/code', {
        client_id: 'test-client',
        scope: 'repo read:org',
      });
    });
  });
});
