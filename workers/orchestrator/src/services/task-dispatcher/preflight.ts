import type { Result } from '@intexuraos/common-core';
import type { CreateTaskRequest } from '../../types/api.js';
import { WORKER_TYPES } from '../isolation/types.js';
import type { WorkerAuthProvider } from '../worker-auth/index.js';
import type { IsolationConfig, DispatchError } from '../task-dispatcher.js';

/**
 * INT-1551 §E.6: pre-flight gates extracted from the TaskDispatcher class.
 *
 * Each gate returns `null` on success and a `Result.error` on failure so the
 * caller can early-return.
 */

/**
 * Returns `null` if the isolation provider is healthy (or doesn't expose a
 * health check); returns a `docker_unavailable` error otherwise.
 */
export function checkDockerAvailability(
  isolation: IsolationConfig
): Result<void, DispatchError> | null {
  if (isolation.provider.isHealthy?.() === false) {
    return {
      ok: false,
      error: { type: 'docker_unavailable', message: 'Docker daemon is not responding' },
    };
  }
  return null;
}

/**
 * Maps a worker type to the auth provider it requires (or `null` if no
 * managed auth provider is needed — e.g. raw API-key-only workers).
 */
export function getRequiredWorkerAuthProvider(
  workerType: CreateTaskRequest['workerType']
): WorkerAuthProvider | null {
  const workerTypeConfig = WORKER_TYPES[workerType];
  if (workerTypeConfig.runtime === 'codex') {
    return 'codex';
  }
  if (workerTypeConfig.apiKeyEnvVar === 'ANTHROPIC_API_KEY') {
    return 'claude';
  }
  return null;
}

/**
 * Returns `null` if the worker auth provider for the given worker type is
 * ready (active, or — for codex — expired-but-refreshable); otherwise
 * returns an `auth_unavailable` error.
 */
export function checkWorkerAuthAvailability(
  workerType: CreateTaskRequest['workerType'],
  isolation: IsolationConfig
): Result<void, DispatchError> | null {
  const provider = getRequiredWorkerAuthProvider(workerType);
  if (provider === null) {
    return null;
  }

  const authState = isolation.workerAuthRegistry.getState(provider);
  const isReady =
    provider === 'codex'
      ? authState.status === 'active' ||
        (authState.status === 'expired' && authState.refreshSupported)
      : authState.status === 'active';

  if (isReady) {
    return null;
  }

  const providerName = provider === 'claude' ? 'Claude' : 'Codex';
  return {
    ok: false,
    error: {
      type: 'auth_unavailable',
      message: `${providerName} auth is not ready: ${authState.message ?? authState.status}`,
    },
  };
}
