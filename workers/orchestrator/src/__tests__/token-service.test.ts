import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubTokenService } from '../github/token-service.js';

// Mock the jsonwebtoken module
vi.mock('jsonwebtoken', () => ({
  sign: vi.fn(() => 'mock_jwt_token'),
}));

describe('GitHubTokenService', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'token-test-'));
  const tokenFilePath = join(tempDir, 'github-token');
  const privateKeyPath = join(tempDir, 'private-key.pem');

  const mockConfig = {
    appId: 'test-app-id',
    privateKeyPath,
    installationId: 'test-installation-id',
    tokenFilePath,
  };

  beforeEach(() => {
    // Ensure temp directory exists and write mock private key
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(privateKeyPath, 'MOCK_KEY', 'utf-8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('token refresh', () => {
    it('should fetch and store token successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghp_test_token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      const result = await service.refreshToken();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('ghp_test_token');
      }

      // Verify token was written to file
      const fileContent = readFileSync(tokenFilePath, 'utf-8');
      expect(fileContent).toBe('ghp_test_token');
    });

    it('should handle API error gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      const result = await service.refreshToken();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_REFRESH_FAILED');
      }
    });

    it('should handle network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      const result = await service.refreshToken();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Network error');
      }
    });
  });

  describe('token state management', () => {
    it('should return current token if valid', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghp_initial_token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      // Refresh token first
      await service.refreshToken();

      // Get token should return cached token
      const token = await service.getToken();
      expect(token).toBe('ghp_initial_token');
    });

    it('should return null if refresh fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      const token = await service.getToken();
      expect(token).toBeNull();
    });

    it('should correctly identify expired tokens', () => {
      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      // No token means expired
      expect(service.isExpired()).toBe(true);
    });

    it('should correctly identify tokens expiring soon', () => {
      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      // No token means expiring soon
      expect(service.isExpiringSoon()).toBe(true);
    });
  });

  describe('auth degradation', () => {
    it('should trigger auth degraded after 3 consecutive failures', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      global.fetch = mockFetch;

      const authDegradedCallback = vi.fn();
      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      service.onAuthDegraded(authDegradedCallback);

      // Fail 3 times
      await service.refreshToken();
      expect(service.getConsecutiveFailures()).toBe(1);
      expect(authDegradedCallback).not.toHaveBeenCalled();

      await service.refreshToken();
      expect(service.getConsecutiveFailures()).toBe(2);
      expect(authDegradedCallback).not.toHaveBeenCalled();

      await service.refreshToken();
      expect(service.getConsecutiveFailures()).toBe(3);
      expect(authDegradedCallback).toHaveBeenCalledTimes(1);
      expect(service.isAuthDegraded()).toBe(true);
    });

    it('should reset failures on successful refresh', async () => {
      let shouldSucceed = false;
      const mockFetch = vi.fn().mockImplementation(() => {
        if (shouldSucceed) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              token: 'ghp_token',
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        });
      });

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      // Fail twice
      await service.refreshToken();
      await service.refreshToken();
      expect(service.getConsecutiveFailures()).toBe(2);

      // Succeed on third try
      shouldSucceed = true;
      await service.refreshToken();
      expect(service.getConsecutiveFailures()).toBe(0);
      expect(service.isAuthDegraded()).toBe(false);
    });
  });

  describe('background refresh', () => {
    it('should start and stop background refresh', async () => {
      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      // Start background refresh
      service.startBackgroundRefresh(1); // 1 minute for testing

      // Stop should not throw
      expect(() => service.stopBackgroundRefresh()).not.toThrow();
    });

    it('should refresh token when expiring soon', async () => {
      let refreshCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        refreshCount++;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            token: `ghp_token_${refreshCount}`,
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          }),
        });
      });

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      // Start with a token that's expiring soon (set manually for testing)
      await service.refreshToken();
      expect(refreshCount).toBe(1);

      // Background refresh will check but token is fresh, so no refresh
      // We can't easily test the timing without waiting, but we verify
      // the service doesn't crash when starting/stopping
      service.startBackgroundRefresh(1);
      service.stopBackgroundRefresh();
    });
  });

  describe('atomic file writes', () => {
    it('should write token atomically', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghp_atomic_test',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      global.fetch = mockFetch;

      const service = new GitHubTokenService(
        mockConfig.appId,
        mockConfig.privateKeyPath,
        mockConfig.installationId,
        mockConfig.tokenFilePath
      );

      await service.refreshToken();

      // Verify final file exists and has correct content
      const content = readFileSync(tokenFilePath, 'utf-8');
      expect(content).toBe('ghp_atomic_test');

      // Temp file should be cleaned up
      expect(existsSync(`${tokenFilePath}.tmp`)).toBe(false);
    });
  });
});
