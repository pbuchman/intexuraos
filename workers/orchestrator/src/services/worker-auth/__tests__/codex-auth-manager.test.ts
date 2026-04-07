import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import { CodexAuthManager } from '../codex-auth-manager.js';
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

function createJwt(expiresAtMs: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(expiresAtMs / 1000),
      iat: Math.floor((expiresAtMs - 60_000) / 1000),
      iss: 'https://auth.openai.com',
      aud: ['https://api.openai.com/v1'],
    })
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('CodexAuthManager', () => {
  let manager: CodexAuthManager;
  let mockLogger: Logger;
  let mockExistsSync: Mock;
  let mockReadFileSync: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T12:00:00.000Z'));

    mockLogger = createMockLogger();
    mockExistsSync = fs.existsSync as Mock;
    mockReadFileSync = fs.readFileSync as Mock;

    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
      },
      mockLogger
    );
  });

  afterEach(() => {
    manager.stopMonitoring();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads active ChatGPT auth and exposes expiry and last refresh', () => {
    const expiresAt = Date.parse('2026-03-26T16:00:00.000Z');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-03-26T11:45:00.000Z',
        tokens: {
          access_token: createJwt(expiresAt),
          id_token: createJwt(expiresAt),
          refresh_token: 'refresh-token',
          account_id: 'acct_123',
        },
      })
    );

    const result = manager.loadCredentials();

    expect(result).toBe(true);
    expect(manager.getState()).toEqual({
      status: 'active',
      authMode: 'chatgpt',
      refreshSupported: true,
      expiresAt: '2026-03-26T16:00:00.000Z',
      expiresInMinutes: 240,
      lastRefreshAt: '2026-03-26T11:45:00.000Z',
    });
  });

  it('reports invalid when auth_mode is api_key', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'api_key',
        tokens: {
          access_token: 'sk-test',
        },
      })
    );

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'invalid',
      authMode: null,
      refreshSupported: false,
      message: 'Codex shared auth must use ChatGPT device auth — rerun codex-login.sh',
    });
  });

  it('reports not_configured when auth file is missing', () => {
    mockExistsSync.mockReturnValue(false);

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'not_configured',
      authMode: null,
      refreshSupported: false,
      message: 'Codex auth file not found',
    });
  });

  it('reports expired when ChatGPT access token is expired', () => {
    const expiresAt = Date.parse('2026-03-26T11:30:00.000Z');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-03-26T11:00:00.000Z',
        tokens: {
          access_token: createJwt(expiresAt),
          id_token: createJwt(expiresAt),
          refresh_token: 'refresh-token',
          account_id: 'acct_123',
        },
      })
    );

    manager.loadCredentials();

    expect(manager.getState()).toEqual({
      status: 'expired',
      authMode: 'chatgpt',
      refreshSupported: true,
      expiresAt: '2026-03-26T11:30:00.000Z',
      expiresInMinutes: -30,
      lastRefreshAt: '2026-03-26T11:00:00.000Z',
      message: 'Codex ChatGPT access token expired',
    });
  });

  it('reports invalid when auth_mode is unsupported', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'unknown',
        tokens: {},
      })
    );

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'invalid',
      authMode: null,
      refreshSupported: false,
      message: 'Unsupported Codex auth_mode: unknown',
    });
  });

  it('reports invalid when ChatGPT auth is missing access token', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          refresh_token: 'refresh-token',
        },
      })
    );

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'invalid',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex ChatGPT auth is missing an access token',
    });
  });

  it('returns true from isExpiringSoon when ChatGPT auth is near expiry', () => {
    const expiresAt = Date.parse('2026-03-26T12:03:00.000Z');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-03-26T11:45:00.000Z',
        tokens: {
          access_token: createJwt(expiresAt),
          id_token: createJwt(expiresAt),
          refresh_token: 'refresh-token',
          account_id: 'acct_123',
        },
      })
    );

    manager.loadCredentials();

    expect(manager.isExpiringSoon(5 * 60 * 1000)).toBe(true);
  });

  it('returns false from isExpiringSoon for invalid api_key auth_mode', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'api_key',
        tokens: {
          access_token: 'sk-test',
        },
      })
    );

    manager.loadCredentials();

    expect(manager.isExpiringSoon(5 * 60 * 1000)).toBe(false);
  });

  it('reports invalid when auth file cannot be parsed', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{not-json');

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'invalid',
      authMode: null,
      refreshSupported: false,
      message: 'Failed to parse Codex auth file',
    });
  });

  it('normalizes non-Error read failures during auth parsing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw 'boom';
    });

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'boom' }),
        path: '/home/user/.code-orchestrator/codex-auth/auth.json',
      }),
      'Failed to parse Codex auth file'
    );
  });

  it('reports invalid when ChatGPT token payload is missing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'not-a-jwt',
        },
      })
    );

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'invalid',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex ChatGPT access token could not be decoded',
    });
  });

  it('reports invalid when ChatGPT token payload is malformed JSON', () => {
    const malformedJwt = `header.${Buffer.from('not-json').toString('base64url')}.sig`;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: malformedJwt,
        },
      })
    );

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'invalid',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex ChatGPT access token could not be decoded',
    });
  });

  it('reports invalid when ChatGPT token has a non-numeric exp claim', () => {
    const invalidExpJwt = `header.${Buffer.from(JSON.stringify({ exp: 'later' })).toString('base64url')}.sig`;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: invalidExpJwt,
        },
      })
    );

    const result = manager.loadCredentials();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'invalid',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex ChatGPT access token could not be decoded',
    });
  });

  it('returns false from isExpiringSoon for invalid refreshable state', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          refresh_token: 'refresh-token',
        },
      })
    );

    manager.loadCredentials();

    expect(manager.isExpiringSoon(5 * 60 * 1000)).toBe(false);
  });

  it('returns true from isExpiringSoon for expired refreshable auth', () => {
    const expiresAt = Date.parse('2026-03-26T11:30:00.000Z');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: createJwt(expiresAt),
        },
      })
    );

    manager.loadCredentials();

    expect(manager.isExpiringSoon(5 * 60 * 1000)).toBe(true);
  });

  it('reloads auth on the monitoring interval and stops cleanly', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-03-26T11:45:00.000Z',
        tokens: {
          access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
        },
      })
    );

    manager.startMonitoring();
    vi.advanceTimersByTime(60_000);

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);

    manager.stopMonitoring();
    vi.advanceTimersByTime(60_000);

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns false from refresh when no refresher is configured', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-03-26T11:45:00.000Z',
        tokens: {
          access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
        },
      })
    );

    manager.loadCredentials();

    await expect(manager.refresh()).resolves.toBe(false);
  });

  it('returns null from getCurrentAccessToken', () => {
    expect(manager.getCurrentAccessToken()).toBeNull();
  });

  it('marks refresh_failed when refresher returns false', async () => {
    const refresher = { refresh: vi.fn(async () => false) };
    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
        refresher: refresher as never,
      },
      mockLogger
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-03-26T11:45:00.000Z',
        tokens: {
          access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
        },
      })
    );
    manager.loadCredentials();

    const result = await manager.refresh();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'refresh_failed',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex auth refresh failed — rerun codex-login.sh',
      expiresAt: '2026-03-26T16:00:00.000Z',
      expiresInMinutes: 240,
      lastRefreshAt: '2026-03-26T11:45:00.000Z',
    });
  });

  it('marks refresh_failed without optional timing fields when the previous state lacks them', async () => {
    const refresher = { refresh: vi.fn(async () => false) };
    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
        refresher: refresher as never,
      },
      mockLogger
    );
    (manager as unknown as { state: unknown }).state = {
      status: 'expired',
      authMode: 'chatgpt',
      refreshSupported: true,
    };

    const result = await manager.refresh();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'refresh_failed',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex auth refresh failed — rerun codex-login.sh',
    });
  });

  it('marks refresh_failed when refreshed auth does not advance', async () => {
    const refresher = { refresh: vi.fn(async () => true) };
    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
        refresher: refresher as never,
      },
      mockLogger
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-03-26T11:45:00.000Z',
        tokens: {
          access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
        },
      })
    );
    manager.loadCredentials();

    const result = await manager.refresh();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'refresh_failed',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex auth refresh did not advance the stored auth state — rerun codex-login.sh',
      expiresAt: '2026-03-26T16:00:00.000Z',
      expiresInMinutes: 240,
      lastRefreshAt: '2026-03-26T11:45:00.000Z',
    });
  });

  it('marks refresh_failed without timing fields when reload returns invalid auth', async () => {
    const refresher = { refresh: vi.fn(async () => true) };
    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
        refresher: refresher as never,
      },
      mockLogger
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-03-26T11:45:00.000Z',
          tokens: {
            access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
          },
        })
      )
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            refresh_token: 'missing-access-token',
          },
        })
      );
    manager.loadCredentials();

    const result = await manager.refresh();

    expect(result).toBe(false);
    expect(manager.getState()).toEqual({
      status: 'refresh_failed',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'Codex auth refresh did not advance the stored auth state — rerun codex-login.sh',
    });
  });

  it('returns true from refresh when last_refresh advances', async () => {
    const refresher = { refresh: vi.fn(async () => true) };
    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
        refresher: refresher as never,
      },
      mockLogger
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-03-26T11:45:00.000Z',
          tokens: {
            access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
          },
        })
      )
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-03-26T12:05:00.000Z',
          tokens: {
            access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
          },
        })
      );
    manager.loadCredentials();

    await expect(manager.refresh()).resolves.toBe(true);
    expect(manager.getState()).toEqual({
      status: 'active',
      authMode: 'chatgpt',
      refreshSupported: true,
      expiresAt: '2026-03-26T16:00:00.000Z',
      expiresInMinutes: 240,
      lastRefreshAt: '2026-03-26T12:05:00.000Z',
    });
  });

  it('returns true from refresh when expiry advances without last_refresh', async () => {
    const refresher = { refresh: vi.fn(async () => true) };
    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
        refresher: refresher as never,
      },
      mockLogger
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
          },
        })
      )
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: createJwt(Date.parse('2026-03-26T18:00:00.000Z')),
          },
        })
      );
    manager.loadCredentials();

    await expect(manager.refresh()).resolves.toBe(true);
    expect(manager.getState()).toEqual({
      status: 'active',
      authMode: 'chatgpt',
      refreshSupported: true,
      expiresAt: '2026-03-26T18:00:00.000Z',
      expiresInMinutes: 360,
    });
  });

  it('returns true from refresh when last_refresh appears for the first time', async () => {
    const refresher = { refresh: vi.fn(async () => true) };
    manager = new CodexAuthManager(
      {
        authPath: '/home/user/.code-orchestrator/codex-auth/auth.json',
        reloadIntervalMs: 60_000,
        refresher: refresher as never,
      },
      mockLogger
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
          },
        })
      )
      .mockReturnValueOnce(
        JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-03-26T12:05:00.000Z',
          tokens: {
            access_token: createJwt(Date.parse('2026-03-26T16:00:00.000Z')),
          },
        })
      );
    manager.loadCredentials();

    await expect(manager.refresh()).resolves.toBe(true);
    expect(manager.getState()).toEqual({
      status: 'active',
      authMode: 'chatgpt',
      refreshSupported: true,
      expiresAt: '2026-03-26T16:00:00.000Z',
      expiresInMinutes: 240,
      lastRefreshAt: '2026-03-26T12:05:00.000Z',
    });
  });
});
