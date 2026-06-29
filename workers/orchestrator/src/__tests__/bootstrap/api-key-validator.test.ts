import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { IntexuraOSError } from '@intexuraos/common-core';
import {
  validateWorkerApiKey,
  keySuffix,
  extractErrorChain,
  fetchWithRetry,
  logWorkerAuthStartupStatus,
  validateWorkerApiKeys,
  validateThirdPartyApiKey,
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

  // INT-1565 acceptance: bootstrap failures must be typed `IntexuraOSError`s
  // (no plain `throw new Error(`) so call sites can branch on `error.code`.
  it('throws an IntexuraOSError with code MISCONFIGURED', () => {
    try {
      validateWorkerApiKey('ANTHROPIC_API_KEY', '');
      throw new Error('expected validateWorkerApiKey to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IntexuraOSError);
      expect((err as IntexuraOSError).code).toBe('MISCONFIGURED');
    }
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
    // Sentry INTEXURAOS-HOME-DEV-1G: expired-token startup warn must not page.
    expect(claudeWarn[0]?.[1]).toMatchObject({ _skipSentry: true });
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
    // Sentry INTEXURAOS-HOME-DEV-1G: expired-token startup warn must not page.
    expect(codexWarn[0]?.[1]).toMatchObject({ _skipSentry: true });
  });
});

describe('validateWorkerApiKeys — auth-state logging branches', () => {
  // Empty third-party keys short-circuit the Promise.all before any network
  // call, so these tests exercise only the auth-state logging branches.
  const noKeys = {
    minimaxKey: '',
    mimoKey: '',
    dashscopeKey: '',
    kimiKey: '',
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
    // Sentry INTEXURAOS-HOME-DEV-1G: this is the exact warn that produced the issue;
    // it must carry `_skipSentry` so the Pino transport does not forward it.
    expect(claudeWarn[0]?.[1]).toMatchObject({ _skipSentry: true });
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
    // Sentry INTEXURAOS-HOME-DEV-1G: same suppression contract as the Claude warn.
    expect(codexWarn[0]?.[1]).toMatchObject({ _skipSentry: true });
  });
});

describe('validateThirdPartyApiKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Sentry INTEXURAOS-HOME-DEV-1F: the KIMI/MINIMAX/MIMO/DashScope/OpenRouter
  // startup-time validation error is informational — the real user impact
  // (a worker task failing) surfaces via the per-task error path. The Pino
  // Sentry transport must not page on every orchestrator restart when one
  // of these keys has been rotated/revoked upstream.
  it('carries _skipSentry on the error log when the upstream returns a non-2xx', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));

    const logger = makeLogger();
    await validateThirdPartyApiKey('kimi', 'sk-test-key-1234', logger);

    expect(fetchSpy).toHaveBeenCalled();
    const errorCall = logger.calls.find(
      ([level, , message]) =>
        level === 'error' && typeof message === 'string' && message.startsWith('KIMI_API_KEY')
    );
    expect(errorCall).toBeDefined();
    expect(errorCall?.[1]).toMatchObject({ _skipSentry: true });
  });

  it('does not carry _skipSentry on the success info log', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"content":[]}', { status: 200 })
    );

    const logger = makeLogger();
    await validateThirdPartyApiKey('kimi', 'sk-test-key-1234', logger);

    const successCall = logger.calls.find(
      ([level, , message]) =>
        level === 'info' && typeof message === 'string' && message.startsWith('KIMI_API_KEY')
    );
    expect(successCall).toBeDefined();
    // Success path must remain pageable — a successful validation is a
    // positive signal we want to keep in Sentry noise.
    expect(successCall?.[1]).not.toMatchObject({ _skipSentry: true });
  });

  it.each([
    ['kimi', 'KIMI_API_KEY'],
    ['minimax', 'MINIMAX_API_KEY'],
    ['mimo-pro', 'MIMO_API_KEY'],
    ['qwen', 'DASHSCOPE_API_KEY'],
    ['openrouter-free', 'OPENROUTER_API_KEY'],
  ])('carries _skipSentry on startup validation errors for %s', async (workerTypeName, keyName) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));

    const logger = makeLogger();
    await validateThirdPartyApiKey(workerTypeName, 'sk-test-key-1234', logger);

    const errorCall = logger.calls.find(
      ([level, , message]) =>
        level === 'error' &&
        typeof message === 'string' &&
        message.startsWith(`${keyName} validation failed`)
    );
    expect(errorCall).toBeDefined();
    expect(errorCall?.[1]).toMatchObject({ _skipSentry: true });
  });

  it('uses the OpenRouter key introspection endpoint and bearer authorization', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"data":{}}', { status: 200 }));

    const logger = makeLogger();
    await validateThirdPartyApiKey('openrouter-free', 'sk-test-key-1234', logger);

    const [url, options] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect(options).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer sk-test-key-1234' },
    });
  });

  it('uses the models endpoint for direct API-key runtimes without a configured model', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"data":[]}', { status: 200 }));

    const logger = makeLogger();
    await validateThirdPartyApiKey('auto', 'sk-test-key-1234', logger);

    const [url, options] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect(options).toMatchObject({
      method: 'GET',
      headers: {
        'x-api-key': 'sk-test-key-1234',
        'anthropic-version': '2023-06-01',
      },
    });
  });

  it('skips validation for runtimes without direct API-key authentication', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const logger = makeLogger();
    await validateThirdPartyApiKey('codex', 'sk-test-key-1234', logger);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.calls).toContainEqual([
      'info',
      { workerTypeName: 'codex' },
      'Skipping API-key validation for runtime without direct API-key authentication',
    ]);
  });

  it('logs a warning without _skipSentry when validation cannot reach upstream', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const logger = makeLogger();
    const validation = validateThirdPartyApiKey('kimi', 'sk-test-key-1234', logger);
    await vi.advanceTimersByTimeAsync(6_000);
    await validation;

    const warnCall = logger.calls.find(
      ([level, , message]) =>
        level === 'warn' &&
        message ===
          'KIMI_API_KEY validation request failed (network issue) — key may still be valid'
    );
    expect(warnCall).toBeDefined();
    expect(warnCall?.[1]).toMatchObject({
      error: 'network down',
      url: 'https://api.kimi.com/coding/v1/messages',
      apiKey: '...1234',
    });
    expect(warnCall?.[1]).not.toMatchObject({ _skipSentry: true });
  });
});
