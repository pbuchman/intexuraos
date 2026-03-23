import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import { CredentialMonitor } from '../credential-monitor.js';
import type { Logger } from '@intexuraos/common-core';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

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

describe('CredentialMonitor', () => {
  let monitor: CredentialMonitor;
  let mockLogger: Logger;
  let mockExistsSync: Mock;
  let mockReadFileSync: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    mockExistsSync = fs.existsSync as Mock;
    mockReadFileSync = fs.readFileSync as Mock;

    monitor = new CredentialMonitor(
      {
        credentialsPath: '/home/user/.claude-orchestrator/claude-creds/.credentials.json',
        reloadIntervalMs: 60_000,
      },
      mockLogger
    );
  });

  afterEach(() => {
    monitor.stopMonitoring();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('loadCredentials', () => {
    it('returns false when file not found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = monitor.loadCredentials();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.any(String) }),
        expect.stringContaining('not found')
      );
    });

    it('returns true for valid credentials', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));

      const result = monitor.loadCredentials();

      expect(result).toBe(true);
      expect(monitor.getState().status).toBe('active');
    });

    it('returns false for malformed JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not json {{');

      const result = monitor.loadCredentials();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('parse')
      );
    });

    it('wraps non-Error thrown value during parsing', () => {
      mockExistsSync.mockReturnValue(true);
      const nonError = 'string-parse-error';
      mockReadFileSync.mockImplementation(() => {
        throw nonError;
      });

      const result = monitor.loadCredentials();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: 'string-parse-error' }),
          path: expect.any(String),
        }),
        expect.stringContaining('parse')
      );
    });

    it('returns false when claudeAiOauth field missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ mcpOAuth: {} }));

      const result = monitor.loadCredentials();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('claudeAiOauth')
      );
    });
  });

  describe('getCurrentAccessToken', () => {
    it('returns null when not loaded', () => {
      expect(monitor.getCurrentAccessToken()).toBeNull();
    });

    it('returns token after loading', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      monitor.loadCredentials();

      expect(monitor.getCurrentAccessToken()).toBe('sk-ant-oat01-valid-access-token');
    });
  });

  describe('getState', () => {
    it('returns active with details for valid credentials', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      monitor.loadCredentials();

      const state = monitor.getState();

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
      monitor.loadCredentials();

      const state = monitor.getState();

      expect(state.status).toBe('expired');
    });

    it('returns not_configured when credentials not loaded', () => {
      const state = monitor.getState();

      expect(state).toEqual({
        status: 'not_configured',
        message: expect.any(String),
      });
    });
  });

  describe('isExpiringSoon', () => {
    it('returns true when within buffer', () => {
      const nearExpiry = {
        claudeAiOauth: {
          ...VALID_CREDENTIALS.claudeAiOauth,
          expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes from now
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(nearExpiry));
      monitor.loadCredentials();

      expect(monitor.isExpiringSoon(5 * 60 * 1000)).toBe(true);
    });

    it('returns false when well within validity', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      monitor.loadCredentials();

      expect(monitor.isExpiringSoon(5 * 60 * 1000)).toBe(false);
    });

    it('returns true when credentials not loaded', () => {
      expect(monitor.isExpiringSoon(5 * 60 * 1000)).toBe(true);
    });

    it('returns true when credentials already expired', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      monitor.loadCredentials();

      expect(monitor.isExpiringSoon(5 * 60 * 1000)).toBe(true);
    });
  });

  describe('startMonitoring', () => {
    it('periodically re-reads from disk', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      monitor.loadCredentials();

      mockReadFileSync.mockClear();
      mockExistsSync.mockClear();

      monitor.startMonitoring();

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));

      vi.advanceTimersByTime(60_000);

      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockReadFileSync).toHaveBeenCalled();
    });
  });

  describe('stopMonitoring', () => {
    it('clears interval', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      monitor.loadCredentials();

      monitor.startMonitoring();
      monitor.stopMonitoring();

      mockReadFileSync.mockClear();
      mockExistsSync.mockClear();

      vi.advanceTimersByTime(120_000);

      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('is safe to call when not monitoring', () => {
      expect(() => monitor.stopMonitoring()).not.toThrow();
    });
  });

  describe('logStartupStatus', () => {
    it('logs active token details', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CREDENTIALS));
      monitor.loadCredentials();

      monitor.logStartupStatus();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionType: 'max' }),
        expect.stringContaining('active')
      );
    });

    it('logs warning for not configured state', () => {
      monitor.logStartupStatus();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('not configured')
      );
    });

    it('logs warning for expired token', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(EXPIRED_CREDENTIALS));
      monitor.loadCredentials();

      monitor.logStartupStatus();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('expired')
      );
    });
  });
});
