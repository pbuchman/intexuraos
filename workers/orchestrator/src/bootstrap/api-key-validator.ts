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

import { IntexuraOSError } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { WORKER_TYPES } from '../services/isolation/types.js';
import type { WorkerAuthRegistry } from '../services/worker-auth/index.js';
import type { ProviderApiKeyHealth, ProviderApiKeyValidationStatus } from '../types/api.js';

/**
 * Synchronously validates an API key's format. Throws if the key is missing
 * or is only whitespace. This is the ONLY throwing validator — live
 * validation is best-effort and warns.
 */
export function validateWorkerApiKey(name: string, value: string): void {
  if (value === '' || value.trim() === '') {
    throw new IntexuraOSError('MISCONFIGURED', `API key ${name} is empty or whitespace-only`);
  }
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
  /* v8 ignore start -- upstream: the `if (attempt === retries - 1) throw error` guard above guarantees the final retry always throws when retries >= 1 (all real callers use retries >= 3), so this post-loop throw is unreachable and cannot be driven by any test input @preserve */
  throw lastError instanceof Error ? lastError : new Error('fetchWithRetry: unreachable');
  /* v8 ignore stop @preserve */
}

/**
 * Issues a lightweight request to the upstream API to confirm the key is
 * accepted. Logs success/failure but never throws — a single provider
 * outage must not block the orchestrator from starting.
 */
export async function validateThirdPartyApiKey(
  workerTypeName: string,
  apiKey: string,
  logger: Logger
): Promise<ProviderApiKeyValidationStatus> {
  const config = WORKER_TYPES[workerTypeName as keyof typeof WORKER_TYPES];
  const keyName = config.apiKeyEnvVar;

  if (keyName === undefined) {
    logger.info(
      { workerTypeName },
      'Skipping API-key validation for runtime without direct API-key authentication'
    );
    return 'unknown';
  }

  // OpenRouter uses a lightweight key introspection endpoint instead of a real inference request,
  // because free-tier models are frequently rate-limited upstream regardless of key validity.
  const isOpenRouter = config.apiBaseUrl.includes('openrouter.ai');
  const providerAuthHeaders =
    config.anthropicCredentialEnvVar === 'ANTHROPIC_AUTH_TOKEN'
      ? { Authorization: `Bearer ${apiKey}` }
      : { 'x-api-key': apiKey };

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
            ...providerAuthHeaders,
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
          headers: { ...providerAuthHeaders, 'anthropic-version': '2023-06-01' },
        };

  try {
    const resp = await fetchWithRetry(url, fetchOptions);
    if (resp.ok) {
      logger.info({}, `${keyName} validated successfully`);
      return 'valid';
    } else {
      // Sentry INTEXURAOS-HOME-DEV-1F: this is a startup-time health probe, not a
      // runtime failure. The orchestrator continues to boot while code-agent
      // uses the published health status to block dispatch for the affected
      // provider. Forwarding
      // this to Sentry on every orchestrator restart (PM2 auto-restart loop)
      // produces alert noise that the previous INT-1767 fix suppressed for the
      // Claude/Codex auth-state warns; the third-party validator hits the same
      // Pino transport, so it needs the same `_skipSentry` escape hatch.
      logger.error(
        { status: resp.status, _skipSentry: true },
        `${keyName} validation failed — ${workerTypeName} tasks are unavailable`
      );
      if (resp.status === 401 || resp.status === 403) {
        return 'invalid';
      }
      if (resp.status === 429 || resp.status >= 500) {
        return 'degraded';
      }
      return 'unknown';
    }
  } catch (error) {
    const errorDetail = extractErrorChain(error);
    logger.warn(
      { error: errorDetail, url },
      `${keyName} validation request failed (network issue) — key may still be valid`
    );
    return 'unknown';
  }
}

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
    // Expired OAuth tokens are refreshed on first use; this warning is informational.
    // Real auth failures still surface via per-task error paths.
    logger.warn({ state: claudeState, _skipSentry: true }, 'Code worker auth not ready');
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
    // Same rationale as Claude: expired Codex auth is refreshed on demand,
    // not a startup-time error worth paging on.
    logger.warn({ state: codexState, _skipSentry: true }, 'Codex worker auth not ready');
  }
}

/** Third-party keys validated at startup (live network requests). */
export interface WorkerApiKeysForValidation {
  minimaxKey: string;
  mimoKey: string;
  dashscopeKey: string;
  kimiKey: string;
  openRouterKey: string;
}

/**
 * Runs all startup validation in parallel: logs claude/codex worker auth
 * state, then issues live validation requests for the third-party
 * providers that have direct API keys. Empty keys are skipped.
 *
 * Never throws — a failed upstream request warns and returns.
 */
export async function validateWorkerApiKeys(
  workerAuthRegistry: WorkerAuthRegistry,
  keys: WorkerApiKeysForValidation,
  logger: Logger,
  providerApiKeys: Record<string, ProviderApiKeyHealth>
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
    // Sentry INTEXURAOS-HOME-DEV-1G: an expired Claude OAuth token at startup is
    // expected (tokens are refreshed on first use), so this warn is informational
    // and must not become alert noise. The Pino Sentry transport honors
    // `_skipSentry` and still writes the log to stdout for Cloud Logging.
    logger.warn({ state: claudeState, _skipSentry: true }, 'Code worker auth not ready at startup');
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
    // Same rationale as Claude: do not page on an informational startup state.
    logger.warn({ state: codexState, _skipSentry: true }, 'Codex worker auth not ready at startup');
  }

  const validateProvider = async (
    workerTypeName: string,
    keyName: string,
    apiKey: string
  ): Promise<void> => {
    if (apiKey.trim() === '') {
      return;
    }
    const status = await validateThirdPartyApiKey(workerTypeName, apiKey, logger);
    providerApiKeys[keyName] = { configured: true, status };
  };

  // Validate all third-party API keys in parallel.
  // GLM and Qwen use the DashScope API key; Kimi uses its own native Kimi Code key.
  await Promise.all([
    validateProvider('minimax', 'MINIMAX_API_KEY', keys.minimaxKey),
    validateProvider('mimo-pro', 'MIMO_API_KEY', keys.mimoKey),
    validateProvider('qwen', 'DASHSCOPE_API_KEY', keys.dashscopeKey),
    validateProvider('kimi', 'KIMI_API_KEY', keys.kimiKey),
    validateProvider('openrouter-free', 'OPENROUTER_API_KEY', keys.openRouterKey),
  ]);
}
