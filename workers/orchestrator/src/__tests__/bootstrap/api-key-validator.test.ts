import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import {
  validateWorkerApiKey,
  keySuffix,
  extractErrorChain,
  fetchWithRetry,
  logWorkerAuthStartupStatus,
  validateWorkerApiKeys,
  type FetchWithRetryDeps,
} from '../../bootstrap/api-key-validator.js';
import type { WorkerAuthRegistry, WorkerAuthProvider } from '../../services/worker-auth/index.js';
import type { WorkerAuthState, WorkerAuthStatus } from '../../services/worker-auth/types.js';

type LogEntry = [level: 'info' | 'warn' | 'error' | 'debug', ...args: unknown[]];

function makeLogger(): Logger & { calls: LogEntry[] } {
  const calls: LogEntry[] = [];
  const logger = {
    info: (...args: unknown[]): number => calls.push(['info', ...args]),
    warn: (...args: unknown[]): number => calls.push(['warn', ...args]),
    error: (...args: unknown[]): number => calls.push(['error', ...args]),
    debug: (...args: unknown[]): number => calls.push(['debug', ...args]),
    calls,
  };
  return logger as unknown as Logger & { calls: LogEntry[] };
}

function makeState(
  status: WorkerAuthStatus,
  overrides: Partial<WorkerAuthState> = {}
): WorkerAuthState {
  return {
    status,
    authMode: null,
    refreshSupported: true,
    ...overrides,
  };
}

/** Builds a minimal `WorkerAuthRegistry` fake with just the query methods we exercise. */
function makeRegistry(states: {
  claude?: WorkerAuthState;
  codex?: WorkerAuthState;
}): WorkerAuthRegistry {
  const claude = states.claude ?? makeState('not_configured');
  const codex = states.codex ?? makeState('not_configured');
  return {
    getStates: (): Record<WorkerAuthProvider, WorkerAuthState> => ({ claude, codex }),
    getState: (provider: WorkerAuthProvider): WorkerAuthState =>
      provider === 'claude' ? claude : codex,
  } as unknown as WorkerAuthRegistry;
}

describe('validateWorkerApiKey', () => {
  it('accepts a non-empty key without throwing', () => {
    expect(() => validateWorkerApiKey('ANTHROPIC_API_KEY', 'sk-abc123')).not.toThrow();
  });

  it('throws a validation error for an empty string', () => {
    expect(() => validateWorkerApiKey('ANTHROPIC_API_KEY', '')).toThrow(
      /ANTHROPIC_API_KEY is empty/
    );
  });

  it('throws a validation error for a whitespace-only string', () => {
    expect(() => validateWorkerApiKey('LINEAR_API_KEY', '   \n\t')).toThrow(
      /LINEAR_API_KEY is empty or whitespace-only/
    );
  });

  it('names the key in the error message', () => {
    expect(() => validateWorkerApiKey('CUSTOM_KEY', '')).toThrow(/CUSTOM_KEY/);
  });
});

describe('keySuffix', () => {
  it('returns the last four characters for long keys', () => {
    expect(keySuffix('sk-abcdef1234')).toBe('...1234');
  });

  it('returns a placeholder for short keys', () => {
    expect(keySuffix('abc')).toBe('****');
    expect(keySuffix('abcd')).toBe('****');
  });

  it('returns a placeholder for empty keys', () => {
    expect(keySuffix('')).toBe('****');
  });
});

describe('extractErrorChain', () => {
  it('renders a single Error message', () => {
    expect(extractErrorChain(new Error('boom'))).toBe('boom');
  });

  it('includes NodeJS error codes when present', () => {
    const err = new Error('dns fail') as NodeJS.ErrnoException;
    err.code = 'ENOTFOUND';
    expect(extractErrorChain(err)).toBe('dns fail [ENOTFOUND]');
  });

  it('walks the `cause` chain with separators', () => {
    const inner = new Error('inner');
    const outer = new Error('outer', { cause: inner });
    expect(extractErrorChain(outer)).toBe('outer → inner');
  });

  it('handles string throwables', () => {
    expect(extractErrorChain('bare string')).toBe('bare string');
  });

  it('serializes other value types as JSON', () => {
    expect(extractErrorChain({ code: 500, msg: 'bad' })).toBe('{"code":500,"msg":"bad"}');
  });

  it('returns empty string for null', () => {
    expect(extractErrorChain(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(extractErrorChain(undefined)).toBe('');
  });
});

describe('fetchWithRetry', () => {
  function makeDeps(overrides: Partial<FetchWithRetryDeps> = {}): FetchWithRetryDeps {
    return {
      fetch: vi.fn(async () => new Response('ok')),
      sleep: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it('returns the first successful response without retrying', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok'));
    const sleepSpy = vi.fn(async () => undefined);
    const deps = makeDeps({ fetch: fetchSpy, sleep: sleepSpy });

    const resp = await fetchWithRetry('https://test', {}, 3, 100, deps);
    expect(resp.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('retries after a transient failure and sleeps between attempts', async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return new Response('ok');
    });
    const sleepSpy = vi.fn(async () => undefined);
    const deps = makeDeps({ fetch: fetchSpy, sleep: sleepSpy });

    const resp = await fetchWithRetry('https://test', {}, 3, 100, deps);
    expect(resp.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenNthCalledWith(1, 100);
    expect(sleepSpy).toHaveBeenNthCalledWith(2, 200);
  });

  it('throws the final error after exhausting all retries', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('permanent failure');
    });
    const sleepSpy = vi.fn(async () => undefined);
    const deps = makeDeps({ fetch: fetchSpy, sleep: sleepSpy });

    await expect(fetchWithRetry('https://test', {}, 2, 10, deps)).rejects.toThrow(
      /permanent failure/
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the caller-supplied AbortSignal when provided', async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response('ok');
    });
    const deps = makeDeps({ fetch: fetchSpy });

    await fetchWithRetry('https://test', { signal: controller.signal }, 1, 10, deps);
    expect(capturedSignal).toBe(controller.signal);
  });
});

describe('logWorkerAuthStartupStatus', () => {
  it('logs info for claude when the claude state is active', () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('active', {
        expiresAt: '2030-01-01T00:00:00Z',
        expiresInMinutes: 60,
        subscriptionType: 'pro',
      }),
      codex: makeState('not_configured'),
    });

    logWorkerAuthStartupStatus(registry, logger);

    const infoCalls = logger.calls.filter(([level]) => level === 'info');
    expect(infoCalls).toHaveLength(1);
    expect(infoCalls[0]?.[1]).toMatchObject({
      expiresAt: '2030-01-01T00:00:00Z',
      expiresInMinutes: 60,
      subscriptionType: 'pro',
    });
    expect(infoCalls[0]?.[2]).toBe('Code worker auth active');
  });

  it('warns for claude when the claude state is not active', () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('not_configured'),
      codex: makeState('active', { authMode: 'oauth' }),
    });

    logWorkerAuthStartupStatus(registry, logger);

    const claudeWarn = logger.calls.filter(
      ([level, , message]) => level === 'warn' && message === 'Code worker auth not ready'
    );
    expect(claudeWarn).toHaveLength(1);
  });

  it('logs info for codex when the codex state is active', () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('not_configured'),
      codex: makeState('active', {
        authMode: 'chatgpt',
        expiresAt: '2030-01-01T00:00:00Z',
        expiresInMinutes: 30,
        lastRefreshAt: '2029-12-31T23:30:00Z',
      }),
    });

    logWorkerAuthStartupStatus(registry, logger);

    const codexInfo = logger.calls.filter(
      ([level, , message]) => level === 'info' && message === 'Codex worker auth active'
    );
    expect(codexInfo).toHaveLength(1);
    expect(codexInfo[0]?.[1]).toMatchObject({
      authMode: 'chatgpt',
      expiresAt: '2030-01-01T00:00:00Z',
      expiresInMinutes: 30,
      lastRefreshAt: '2029-12-31T23:30:00Z',
    });
  });

  it('warns for codex when the codex state is not active', () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('active'),
      codex: makeState('expired'),
    });

    logWorkerAuthStartupStatus(registry, logger);

    const codexWarn = logger.calls.filter(
      ([level, , message]) => level === 'warn' && message === 'Codex worker auth not ready'
    );
    expect(codexWarn).toHaveLength(1);
  });
});

describe('validateWorkerApiKeys — auth-state logging branches', () => {
  // Empty third-party keys short-circuit the Promise.all before any network
  // call, so these tests exercise only the auth-state logging branches.
  const noKeys = {
    minimaxKey: '',
    mimoKey: '',
    dashscopeKey: '',
    openRouterKey: '',
  };

  it('logs info for claude when the claude state is active', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('active', {
        expiresInMinutes: 120,
        subscriptionType: 'team',
      }),
      codex: makeState('not_configured'),
    });

    await validateWorkerApiKeys(registry, noKeys, logger);

    const claudeInfo = logger.calls.filter(
      ([level, , message]) =>
        level === 'info' && message === 'Code worker auth validated — Claude-backed tasks ready'
    );
    expect(claudeInfo).toHaveLength(1);
    expect(claudeInfo[0]?.[1]).toMatchObject({
      expiresInMinutes: 120,
      subscriptionType: 'team',
    });
  });

  it('warns for claude when the claude state is not active', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('refresh_failed'),
      codex: makeState('active', { authMode: 'oauth' }),
    });

    await validateWorkerApiKeys(registry, noKeys, logger);

    const claudeWarn = logger.calls.filter(
      ([level, , message]) =>
        level === 'warn' && message === 'Code worker auth not ready at startup'
    );
    expect(claudeWarn).toHaveLength(1);
  });

  it('logs info for codex when the codex state is active', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('not_configured'),
      codex: makeState('active', {
        authMode: 'chatgpt',
        expiresInMinutes: 45,
        lastRefreshAt: '2030-01-01T00:00:00Z',
      }),
    });

    await validateWorkerApiKeys(registry, noKeys, logger);

    const codexInfo = logger.calls.filter(
      ([level, , message]) =>
        level === 'info' && message === 'Codex worker auth validated — Codex tasks ready'
    );
    expect(codexInfo).toHaveLength(1);
    expect(codexInfo[0]?.[1]).toMatchObject({
      authMode: 'chatgpt',
      expiresInMinutes: 45,
      lastRefreshAt: '2030-01-01T00:00:00Z',
    });
  });

  it('warns for codex when the codex state is not active', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      claude: makeState('active'),
      codex: makeState('invalid'),
    });

    await validateWorkerApiKeys(registry, noKeys, logger);

    const codexWarn = logger.calls.filter(
      ([level, , message]) =>
        level === 'warn' && message === 'Codex worker auth not ready at startup'
    );
    expect(codexWarn).toHaveLength(1);
  });
});
