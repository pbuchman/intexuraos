import type { Result } from '@intexuraos/common-core';
import type { CreateTaskRequest } from '../../types/api.js';
import { CODE_TASK_WORKER_CAPABILITIES } from '@intexuraos/code-task-domain';
import { WorkerTypeDisabledError } from '../worker-type-disabled-error.js';
import type { IsolationConfig, DispatchError } from '../task-dispatcher.js';

/**
 * INT-1551 §E.6: pre-flight gates extracted from the TaskDispatcher class.
 *
 * Each gate returns `null` on success and a `Result.error` on failure so the
 * caller can early-return.
 */

export function disabledWorkerTypeError(
  workerType: CreateTaskRequest['workerType'],
  isolation: IsolationConfig
): WorkerTypeDisabledError | null {
  return isolation.workerTypePolicy?.isEnabled(workerType) === false
    ? new WorkerTypeDisabledError(workerType)
    : null;
}

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
 * Returns `null` if the worker auth provider for the given worker type is
 * ready (active, or — for codex — expired-but-refreshable); otherwise
 * returns an `auth_unavailable` error.
 */
export function checkWorkerAuthAvailability(
  workerType: CreateTaskRequest['workerType'],
  isolation: IsolationConfig
): Result<void, DispatchError> | null {
  const { auth } = CODE_TASK_WORKER_CAPABILITIES[workerType];
  if (auth.kind === 'api_key') {
    if (isolation.getSecrets()[auth.envVar].trim() !== '') return null;
    return {
      ok: false,
      error: { type: 'auth_unavailable', message: `Worker type '${workerType}' requires ${auth.envVar} on this host.` },
    };
  }

  const provider = auth.kind;
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
