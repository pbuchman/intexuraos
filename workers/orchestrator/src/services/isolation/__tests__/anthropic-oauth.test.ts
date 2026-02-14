import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import { AnthropicOAuthManager } from '../anthropic-oauth.js';
import type { Logger } from '@intexuraos/common-core';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      ...actual.promises,
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

const VALID_CREDENTIALS = {
  claudeAiOauth: {
    accessToken: 'sk-ant-oat01-valid-access-token',
    refreshToken: 'sk-ant-ort01-valid-refresh-token',
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    scopes: ['user:inference', 'user:profile'],
    subscriptionType: 'max',
    rateLimitTier: 'max_subscription',
  },
};

const EXPIRED_CREDENTIALS = {
  claudeAiOauth: {
    ...VALID_CREDENTIALS.claudeAiOauth,
    expiresAt: Date.now() - 60 * 1000,
  },
};

const NEAR_EXPIRY_CREDENTIALS = {
  claudeAiOauth: {
    ...VALID_CREDENTIALS.claudeAiOauth,
    expiresAt: Date.now() + 5 * 60 * 1000,
  },
};

describe('AnthropicOAuthManager', () => {
  let manager: AnthropicOAuthManager;
  let mockLogger: Logger;
  let mockExistsSync: Mock;
  let mockReadFileSync: Mock;
  let mockWriteFile: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    mockExistsSync = fs.existsSync as Mock;
    mockReadFileSync = fs.readFileSync as Mock;
    mockWriteFile = fs.promises.writeFile as Mock;

    manager = new AnthropicOAuthManager(
      {
        credentialsPath: '/home/user/.claude/.credentials.json',
        codeAgentUrl: 'http://localhost:8128',
        internalAuthToken: 'test-token',
      },
      mockLogger
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadCredentials', () => {
    it('returns false when file not found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = manager.loadCredentials();

      expect(result).toBe(false);
      expect(manager.getState()).toEqual({
        status: 'not_configured',
        message: expect.stringContaining('not found'),
      });
    });

    it('returns true for valid file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));

      const result = manager.loadCredentials();

      expect(result).toBe(true);
      expect(manager.getState().status).toBe('active');
    });

    it('returns false for malformed JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not json {{');

      const result = manager.loadCredentials();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('parse')
      );
    });

    it('returns false when claudeAiOauth field is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpOAuth: {} }));

      const result = manager.loadCredentials();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('claudeAiOauth')
      );
    });
  });

  describe('getAccessToken', () => {
    it('returns current access token when not expired', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      manager.loadCredentials();

      const token = await manager.getAccessToken();

      expect(token).toBe('sk-ant-oat01-valid-access-token');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refreshes token when near expiry (within 10 min)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(NEAR_EXPIRY_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'sk-ant-oat01-new-access',
            refresh_token: 'sk-ant-ort01-new-refresh',
            expires_in: 14400,
          }),
      });

      const token = await manager.getAccessToken();

      expect(token).toBe('sk-ant-oat01-new-access');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://console.anthropic.com/v1/oauth/token',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('refreshes token when already expired', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'sk-ant-oat01-refreshed',
            refresh_token: 'sk-ant-ort01-refreshed',
            expires_in: 14400,
          }),
      });

      const token = await manager.getAccessToken();

      expect(token).toBe('sk-ant-oat01-refreshed');
    });

    it('persists rotated refresh token to disk', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(NEAR_EXPIRY_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'sk-ant-oat01-new',
            refresh_token: 'sk-ant-ort01-rotated',
            expires_in: 14400,
          }),
      });

      await manager.getAccessToken();

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/user/.claude/.credentials.json',
        expect.stringContaining('sk-ant-ort01-rotated'),
        { mode: 0o600 }
      );
    });

    it('keeps existing refresh token when response omits one', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'sk-ant-oat01-no-rotate',
            expires_in: 14400,
          }),
      });

      const token = await manager.getAccessToken();

      expect(token).toBe('sk-ant-oat01-no-rotate');
      const written = (mockWriteFile.mock.calls[0] as [string, string, string])[1];
      const parsed = JSON.parse(written) as { claudeAiOauth: { refreshToken: string } };
      expect(parsed.claudeAiOauth.refreshToken).toBe(
        EXPIRED_CREDENTIALS.claudeAiOauth.refreshToken
      );
    });

    it('returns null on network error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const token = await manager.getAccessToken();

      expect(token).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('refresh')
      );
    });

    it('returns null and alerts on invalid_grant (revoked)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_grant' }),
      });

      const token = await manager.getAccessToken();

      expect(token).toBeNull();
      // Alert call to code-agent
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:8128/internal/orchestrator/alert',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Internal-Auth': 'test-token',
          }),
        })
      );
    });

    it('handles non-JSON error response gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      });

      const token = await manager.getAccessToken();

      expect(token).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 502 }),
        expect.stringContaining('refresh failed')
      );
    });

    it('returns null on non-invalid_grant HTTP error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'server_error' }),
      });

      const token = await manager.getAccessToken();

      expect(token).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 500 }),
        expect.stringContaining('refresh failed')
      );
      // No alert sent for non-revocation errors
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns null when refresh times out (AbortError)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      const token = await manager.getAccessToken();

      expect(token).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('refresh')
      );
    });

    it('returns null even when alert fails after invalid_grant', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'invalid_grant' }),
        })
        .mockRejectedValueOnce(new Error('Network error during alert'));

      const token = await manager.getAccessToken();

      expect(token).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 400 }),
        expect.stringContaining('revoked')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('alert code-agent')
      );
    });

    it('re-reads credentials from disk before attempting refresh', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          claudeAiOauth: {
            ...NEAR_EXPIRY_CREDENTIALS.claudeAiOauth,
            refreshToken: 'old-refresh-token',
          },
        })
      );
      manager.loadCredentials();

      // Simulate CLI having rotated the token — disk now has NEW refresh token
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          claudeAiOauth: {
            ...NEAR_EXPIRY_CREDENTIALS.claudeAiOauth,
            refreshToken: 'new-refresh-token-from-cli',
          },
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'rotated',
          expires_in: 3600,
        }),
      });

      await manager.getAccessToken();

      const fetchBody = (mockFetch.mock.calls[0] as [string, { body: string }])[1].body;
      expect(fetchBody).toContain('new-refresh-token-from-cli');
      expect(fetchBody).not.toContain('old-refresh-token');
    });

    it('returns null if credentials file becomes invalid during refresh', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(NEAR_EXPIRY_CREDENTIALS));
      manager.loadCredentials();

      // File is now corrupted
      mockExistsSync.mockReturnValue(false);

      const token = await manager.getAccessToken();
      expect(token).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when not configured', async () => {
      const token = await manager.getAccessToken();
      expect(token).toBeNull();
    });

    it('deduplicates concurrent refresh calls', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      let resolveRefresh: (value: unknown) => void;
      const pending = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      mockFetch.mockReturnValueOnce(pending);

      const p1 = manager.getAccessToken();
      const p2 = manager.getAccessToken();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      resolveRefresh!({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'sk-ant-oat01-deduped',
            refresh_token: 'sk-ant-ort01-deduped',
            expires_in: 14400,
          }),
      });

      const [t1, t2] = await Promise.all([p1, p2]);

      expect(t1).toBe('sk-ant-oat01-deduped');
      expect(t2).toBe('sk-ant-oat01-deduped');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCurrentAccessToken', () => {
    it('returns null when credentials not loaded', () => {
      expect(manager.getCurrentAccessToken()).toBeNull();
    });

    it('returns current token after loading credentials', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      manager.loadCredentials();

      expect(manager.getCurrentAccessToken()).toBe('sk-ant-oat01-valid-access-token');
    });

    it('returns refreshed token after getAccessToken refresh', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'sk-ant-oat01-refreshed-sync',
            expires_in: 14400,
          }),
      });

      await manager.getAccessToken();

      expect(manager.getCurrentAccessToken()).toBe('sk-ant-oat01-refreshed-sync');
    });
  });

  describe('getState', () => {
    it('returns active with details for valid credentials', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      manager.loadCredentials();

      const state = manager.getState();

      expect(state.status).toBe('active');
      if (state.status === 'active') {
        expect(state.subscriptionType).toBe('max');
        expect(state.expiresInMinutes).toBeGreaterThan(0);
        expect(state.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('returns expired for expired credentials', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      const state = manager.getState();

      expect(state.status).toBe('expired');
    });

    it('returns not_configured when credentials not loaded', () => {
      const state = manager.getState();

      expect(state).toEqual({
        status: 'not_configured',
        message: expect.any(String),
      });
    });
  });

  describe('logStartupStatus', () => {
    it('logs active token details', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      manager.loadCredentials();

      manager.logStartupStatus();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionType: 'max' }),
        expect.stringContaining('active')
      );
    });

    it('logs warning for not configured state', () => {
      manager.logStartupStatus();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('not configured')
      );
    });

    it('logs warning for expired token', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      manager.loadCredentials();

      manager.logStartupStatus();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('expired')
      );
    });
  });

  describe('persistCredentials (via refresh)', () => {
    it('logs error when write fails during refresh persist', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(NEAR_EXPIRY_CREDENTIALS));
      manager.loadCredentials();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'sk-ant-oat01-new',
            refresh_token: 'sk-ant-ort01-rotated',
            expires_in: 14400,
          }),
      });

      // Make readFileSync throw during persistCredentials (second call is in persist)
      mockReadFileSync.mockReturnValue(JSON.stringify(NEAR_EXPIRY_CREDENTIALS));
      mockWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const token = await manager.getAccessToken();

      // Token is still returned (persist failure doesn't block return)
      expect(token).toBe('sk-ant-oat01-new');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('in-memory token still valid')
      );
    });
  });

  describe('writeTaskCredentials', () => {
    it('skips writing when credentials not loaded', async () => {
      await manager.writeTaskCredentials('/tmp/claude-session-task-0');

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('writes correct file structure to task session path', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      manager.loadCredentials();

      await manager.writeTaskCredentials('/tmp/claude-session-task-1');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/claude-session-task-1/.credentials.json',
        expect.stringContaining('claudeAiOauth'),
        expect.objectContaining({ mode: 0o600 })
      );

      const writtenContent = JSON.parse(
        (mockWriteFile.mock.calls[0] as [string, string, object])[1]
      );
      expect(writtenContent).toHaveProperty('claudeAiOauth');
      expect(writtenContent.claudeAiOauth).toHaveProperty('accessToken');
    });

    it('writes credentials without refresh token to task session', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      manager.loadCredentials();

      await manager.writeTaskCredentials('/tmp/task-session');

      const writtenContent = (mockWriteFile.mock.calls[0] as [string, string, object])[1] as string;
      const parsed = JSON.parse(writtenContent) as {
        claudeAiOauth: { accessToken: string; refreshToken: string; expiresAt: number };
      };
      expect(parsed.claudeAiOauth.accessToken).toBe(VALID_CREDENTIALS.claudeAiOauth.accessToken);
      expect(parsed.claudeAiOauth.refreshToken).toBe('');
      expect(parsed.claudeAiOauth.expiresAt).toBe(VALID_CREDENTIALS.claudeAiOauth.expiresAt);
    });

    it('logs error and re-throws when write fails', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      manager.loadCredentials();

      mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC: no space left'));

      await expect(manager.writeTaskCredentials('/tmp/claude-session-task-2')).rejects.toThrow(
        'ENOSPC'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          taskSessionPath: '/tmp/claude-session-task-2',
        }),
        expect.stringContaining('write task credentials')
      );
    });
  });
});
