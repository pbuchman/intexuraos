/**
 * Worker API key validation.
 *
 * Exposes two layers:
 *   1. `validateWorkerApiKey(name, value)` — pure synchronous format check,
 *      throws on empty / whitespace-only values. Tested in isolation.
 *   2. `validateWorkerApiKeys(...)` — orchestrates live validation against
 *      upstream providers (Anthropic, OpenRouter, DashScope, etc.). It
 *      *warns* but never throws, so a single provider outage never blocks
 *      the orchestrator from starting.
 */

import type { Logger } from 'pino';
import { WORKER_TYPES } from '../services/isolation/types.js';
import type { WorkerAuthRegistry } from '../services/worker-auth/index.js';

/**
 * Synchronously validates an API key's format. Throws if the key is missing
 * or is only whitespace. This is the ONLY throwing validator — live
 * validation is best-effort and warns.
 */
export function validateWorkerApiKey(name: string, value: string): void {
  if (value === '' || value.trim() === '') {
    throw new Error(`API key ${name} is empty or whitespace-only`);
  }
}

/**
 * Renders the last four characters of a key for safe logging.
 * @internal exported for unit tests.
 */
export function keySuffix(key: string): string {
  return key.length > 4 ? '...' + key.slice(-4) : '****';
}

/**
 * Extracts a compact error chain including `cause` links so network
 * failures log as `ENOTFOUND → getaddrinfo ENOTFOUND api.example.com`.
 * @internal exported for unit tests.
 */
export function extractErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current !== null && current !== undefined) {
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      parts.push(code !== undefined ? `${current.message} [${code}]` : current.message);
      current = current.cause;
    } else if (typeof current === 'string') {
      parts.push(current);
      break;
    } else {
      parts.push(JSON.stringify(current));
      break;
    }
  }
  return parts.join(' → ');
}

/** Injectable dependencies for {@link fetchWithRetry}. Production uses globals. */
export interface FetchWithRetryDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const defaultFetchWithRetryDeps: FetchWithRetryDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Retry shim for `fetch` with linear backoff. Delegates the network call
 * and the delay to the injected `deps` so tests can run without real
 * sockets or timers.
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit & { signal?: AbortSignal },
  retries = 3,
  delayMs = 2000,
  deps: FetchWithRetryDeps = defaultFetchWithRetryDeps
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await deps.fetch(input, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(10_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt === retries - 1) throw error;
      await deps.sleep(delayMs * (attempt + 1));
    }
  }
  /* v8 ignore start -- ts-type: the for-loop above always returns on success or throws on the final retry; this unreachable fallback cannot be exercised by any test @preserve */
  throw lastError instanceof Error ? lastError : new Error('fetchWithRetry: unreachable');
  /* v8 ignore stop @preserve */
}

/**
 * Issues a lightweight request to the upstream API to confirm the key is
 * accepted. Logs success/failure but never throws — a single provider
 * outage must not block the orchestrator from starting.
 */
/* v8 ignore start -- module-init: bootstrap-time live upstream validation cannot be unit-tested without real HTTP sockets; the synchronous format validator is unit-tested instead @preserve */
export async function validateThirdPartyApiKey(
  workerTypeName: string,
  apiKey: string,
  logger: Logger
): Promise<void> {
  const config = WORKER_TYPES[workerTypeName as keyof typeof WORKER_TYPES];
  const keyName = config.apiKeyEnvVar;
  const suffix = keySuffix(apiKey);

  if (keyName === undefined) {
    logger.info(
      { workerTypeName },
      'Skipping API-key validation for runtime without direct API-key authentication'
    );
    return;
  }

  // OpenRouter uses a lightweight key introspection endpoint instead of a real inference request,
  // because free-tier models are frequently rate-limited upstream regardless of key validity.
  const isOpenRouter = config.apiBaseUrl.includes('openrouter.ai');

  const url = isOpenRouter
    ? `${config.apiBaseUrl}/v1/key`
    : config.model !== undefined
      ? `${config.apiBaseUrl}/v1/messages`
      : `${config.apiBaseUrl}/v1/models`;

  const fetchOptions = isOpenRouter
    ? {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    : config.model !== undefined
      ? {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        }
      : {
          method: 'GET',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        };

  try {
    const resp = await fetchWithRetry(url, fetchOptions);
    if (resp.ok) {
      logger.info({ apiKey: suffix }, `${keyName} validated successfully`);
    } else {
      logger.error(
        { status: resp.status, apiKey: suffix },
        `${keyName} validation failed — ${workerTypeName} tasks will fail`
      );
    }
  } catch (error) {
    const errorDetail = extractErrorChain(error);
    logger.warn(
      { error: errorDetail, url, apiKey: suffix },
      `${keyName} validation request failed (network issue) — key may still be valid`
    );
  }
}
/* v8 ignore stop @preserve */

/** Logs the initial state of claude/codex worker auth at startup. */
export function logWorkerAuthStartupStatus(
  workerAuthRegistry: WorkerAuthRegistry,
  logger: Logger
): void {
  const states = workerAuthRegistry.getStates();
  const claudeState = states.claude;
  const codexState = states.codex;

  if (claudeState.status === 'active') {
    logger.info(
      {
        expiresAt: claudeState.expiresAt,
        expiresInMinutes: claudeState.expiresInMinutes,
        subscriptionType: claudeState.subscriptionType,
      },
      'Code worker auth active'
    );
  } else {
    logger.warn({ state: claudeState }, 'Code worker auth not ready');
  }

  if (codexState.status === 'active') {
    logger.info(
      {
        authMode: codexState.authMode,
        expiresAt: codexState.expiresAt,
        expiresInMinutes: codexState.expiresInMinutes,
        lastRefreshAt: codexState.lastRefreshAt,
      },
      'Codex worker auth active'
    );
  } else {
    logger.warn({ state: codexState }, 'Codex worker auth not ready');
  }
}

/** Third-party keys validated at startup (live network requests). */
export interface WorkerApiKeysForValidation {
  minimaxKey: string;
  mimoKey: string;
  dashscopeKey: string;
  openRouterKey: string;
}

/**
 * Runs all startup validation in parallel: logs claude/codex worker auth
 * state, then issues live validation requests for the four third-party
 * providers that have direct API keys. Empty keys are skipped.
 *
 * Never throws — a failed upstream request warns and returns.
 */
export async function validateWorkerApiKeys(
  workerAuthRegistry: WorkerAuthRegistry,
  keys: WorkerApiKeysForValidation,
  logger: Logger
): Promise<void> {
  const claudeState = workerAuthRegistry.getState('claude');
  if (claudeState.status === 'active') {
    logger.info(
      {
        expiresInMinutes: claudeState.expiresInMinutes,
        subscriptionType: claudeState.subscriptionType,
      },
      'Code worker auth validated — Claude-backed tasks ready'
    );
  } else {
    logger.warn({ state: claudeState }, 'Code worker auth not ready at startup');
  }

  const codexState = workerAuthRegistry.getState('codex');
  if (codexState.status === 'active') {
    logger.info(
      {
        authMode: codexState.authMode,
        expiresInMinutes: codexState.expiresInMinutes,
        lastRefreshAt: codexState.lastRefreshAt,
      },
      'Codex worker auth validated — Codex tasks ready'
    );
  } else {
    logger.warn({ state: codexState }, 'Codex worker auth not ready at startup');
  }

  // Validate all third-party API keys in parallel.
  // GLM, Qwen, and Kimi all use the same DashScope API key — validate once via qwen.
  /* v8 ignore start -- module-init: validateThirdPartyApiKey fan-out issues live HTTPS probes that cannot be exercised without real sockets; the inner function carries its own ignore and the per-key empty-guard branches short-circuit during unit tests before any network call @preserve */
  await Promise.all([
    keys.minimaxKey !== ''
      ? validateThirdPartyApiKey('minimax', keys.minimaxKey, logger)
      : Promise.resolve(),
    keys.mimoKey !== ''
      ? validateThirdPartyApiKey('mimo-pro', keys.mimoKey, logger)
      : Promise.resolve(),
    keys.dashscopeKey !== ''
      ? validateThirdPartyApiKey('qwen', keys.dashscopeKey, logger)
      : Promise.resolve(),
    keys.openRouterKey !== ''
      ? validateThirdPartyApiKey('openrouter-free', keys.openRouterKey, logger)
      : Promise.resolve(),
  ]);
  /* v8 ignore stop @preserve */
}
