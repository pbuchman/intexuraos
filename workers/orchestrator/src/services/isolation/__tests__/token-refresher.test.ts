import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import { TokenRefresher, type TokenRefresherConfig } from '../token-refresher.js';

// Mock fs at module level
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock crypto
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    createPrivateKey: vi.fn().mockReturnValue({ type: 'private' }),
  };
});

// Mock jose with a class implementation
vi.mock('jose', () => {
  class MockSignJWT {
    setProtectedHeader(): MockSignJWT {
      return this;
    }
    setIssuer(): MockSignJWT {
      return this;
    }
    setIssuedAt(): MockSignJWT {
      return this;
    }
    setExpirationTime(): MockSignJWT {
      return this;
    }
    async sign(): Promise<string> {
      return 'mock-jwt-token';
    }
  }
  return { SignJWT: MockSignJWT };
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import type { Logger } from '@intexuraos/common-core';

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

const createTestConfig = (overrides: Partial<TokenRefresherConfig> = {}): TokenRefresherConfig => ({
  secretsBasePath: '/tmp/claude-secrets',
  githubAppId: 'test-app-id',
  githubAppPrivateKeyPath: '/test/github-app.pem',
  githubInstallationId: 'test-installation-id',
  refreshIntervalMs: 30 * 60 * 1000, // 30 minutes
  ...overrides,
});

describe('TokenRefresher', () => {
  let refresher: TokenRefresher;
  let mockLogger: Logger;
  let config: TokenRefresherConfig;
  let mockReadFile: Mock;
  let mockWriteFile: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    config = createTestConfig();
    refresher = new TokenRefresher(config, mockLogger);

    // Get references to the mock functions
    mockReadFile = fs.promises.readFile as Mock;
    mockWriteFile = fs.promises.writeFile as Mock;

    // Default mock for reading private key
    mockReadFile.mockResolvedValue(
      '-----BEGIN RSA PRIVATE KEY-----\ntest-key\n-----END RSA PRIVATE KEY-----'
    );

    // Default mock for GitHub API
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'ghs_mock_installation_token' }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    refresher.stop();
  });

  describe('registerTask', () => {
    it('mints and writes initial token for task', async () => {
      await refresher.registerTask('task-123');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/claude-secrets/task-123/github-token',
        'ghs_mock_installation_token',
        { mode: 0o600 }
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { taskId: 'task-123' },
        'GitHub token refreshed'
      );
    });

    it('starts refresh interval on first task', async () => {
      await refresher.registerTask('task-123');

      // Initial call
      expect(mockWriteFile).toHaveBeenCalledTimes(1);

      // Advance by just past the refresh interval and wait for async to complete
      await vi.advanceTimersByTimeAsync(config.refreshIntervalMs + 1);

      // Token should be refreshed again (initial + 1)
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
    });

    it('calls GitHub API with correct installation ID', async () => {
      await refresher.registerTask('task-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/test-installation-id/access_tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
            Accept: 'application/vnd.github+json',
          }),
        })
      );
    });
  });

  describe('unregisterTask', () => {
    it('stops refresh interval when last task is removed', async () => {
      await refresher.registerTask('task-123');
      refresher.unregisterTask('task-123');

      // Clear previous calls
      mockWriteFile.mockClear();

      // Advance time - should NOT refresh since no tasks (interval was cleared)
      await vi.advanceTimersByTimeAsync(config.refreshIntervalMs + 1);

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('continues refresh interval while tasks remain', async () => {
      await refresher.registerTask('task-1');
      await refresher.registerTask('task-2');

      refresher.unregisterTask('task-1');

      // Clear previous calls
      mockWriteFile.mockClear();

      // Advance time - should refresh for task-2
      await vi.advanceTimersByTimeAsync(config.refreshIntervalMs + 1);

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/claude-secrets/task-2/github-token',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('throws when GitHub API fails during registerTask', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(refresher.registerTask('task-123')).rejects.toThrow(
        'GitHub token mint failed: 401'
      );
    });

    it('throws when private key read fails during registerTask', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));

      await expect(refresher.registerTask('task-123')).rejects.toThrow('ENOENT: no such file');
    });

    it('continues refreshing other tasks when one fails in background', async () => {
      await refresher.registerTask('task-1');
      await refresher.registerTask('task-2');

      // Clear previous calls
      mockWriteFile.mockClear();
      vi.mocked(mockLogger.error).mockClear();

      // First task fails, second succeeds
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'new-token' }) });

      await vi.advanceTimersByTimeAsync(config.refreshIntervalMs + 1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { taskId: 'task-1', error: expect.any(Error) },
        'Failed to refresh GitHub token'
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/claude-secrets/task-2/github-token',
        'new-token',
        expect.any(Object)
      );
    });
  });

  describe('stop', () => {
    it('clears refresh interval', async () => {
      await refresher.registerTask('task-123');
      refresher.stop();

      // Clear previous calls
      mockWriteFile.mockClear();

      // Advance time - should NOT refresh (interval was cleared)
      await vi.advanceTimersByTimeAsync(config.refreshIntervalMs + 1);

      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokenForTask', () => {
    it('writes token with correct permissions (0o600)', async () => {
      await refresher.registerTask('task-123');

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
        mode: 0o600,
      });
    });
  });

  describe('multiple tasks', () => {
    it('refreshes all active tasks on interval', async () => {
      await refresher.registerTask('task-1');
      await refresher.registerTask('task-2');
      await refresher.registerTask('task-3');

      // Initial writes
      expect(mockWriteFile).toHaveBeenCalledTimes(3);

      // Clear and advance
      mockWriteFile.mockClear();
      await vi.advanceTimersByTimeAsync(config.refreshIntervalMs + 1);

      // All three tasks should be refreshed
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/claude-secrets/task-1/github-token',
        expect.any(String),
        expect.any(Object)
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/claude-secrets/task-2/github-token',
        expect.any(String),
        expect.any(Object)
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/claude-secrets/task-3/github-token',
        expect.any(String),
        expect.any(Object)
      );
    });
  });
});
