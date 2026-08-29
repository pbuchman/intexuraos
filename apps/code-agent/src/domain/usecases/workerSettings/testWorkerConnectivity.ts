/**
 * Use case: test a worker's connectivity by calling its /health endpoint and
 * persist the outcome back into the user's worker settings document.
 *
 * Extracted from the worker settings route handler to keep HTTP concerns
 * (request parsing, status mapping, response shaping) separate from the
 * worker-settings business rules tested here.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { WorkerSettingsRepository } from '../../ports/workerSettingsRepository.js';
import type { UseCaseLogger } from '../../ports/useCaseLogger.js';
import {
  hasLegacyCapacityHealth,
  parseOrchestratorHealthContract,
} from '../../services/orchestratorHealthContract.js';

/**
 * Health check timeout in milliseconds.
 * Kept in sync with the previous inline handler behavior.
 */
export const WORKER_HEALTH_CHECK_TIMEOUT_MS = 10_000;

export interface TestWorkerConnectivityDeps {
  workerSettingsRepo: WorkerSettingsRepository;
  logger: UseCaseLogger;
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

export interface TestWorkerConnectivityInput {
  userId: string;
  workerName: string;
}

export interface TestWorkerConnectivityOutput {
  testStatus: 'success' | 'failure';
  testMessage: string;
  lastTestedAt: string;
}

export interface TestWorkerConnectivityError {
  code: 'not_found' | 'internal_error';
  message: string;
}

export type TestWorkerConnectivityUseCase = (
  input: TestWorkerConnectivityInput
) => Promise<Result<TestWorkerConnectivityOutput, TestWorkerConnectivityError>>;

export function createTestWorkerConnectivityUseCase(
  deps: TestWorkerConnectivityDeps
): TestWorkerConnectivityUseCase {
  const { workerSettingsRepo, logger } = deps;
  const fetchFn = deps.fetchFn ?? fetch;

  return async ({ userId, workerName }) => {
    const configResult = await workerSettingsRepo.getWorkerByName(userId, workerName);

    if (!configResult.ok) {
      logger.error({ error: configResult.error }, 'Failed to get worker config for test');
      return err({ code: 'internal_error', message: configResult.error.message });
    }

    const config = configResult.value;

    if (config === null) {
      return err({ code: 'not_found', message: `Worker '${workerName}' not configured` });
    }

    const lastTestedAt = new Date().toISOString();
    let testStatus: 'success' | 'failure' = 'failure';
    let testMessage = '';

    try {
      const response = await fetchFn(`${config.url}/health`, {
        method: 'GET',
        headers: {
          'CF-Access-Client-Id': config.cfAccessClientId,
          'CF-Access-Client-Secret': config.cfAccessClientSecret,
        },
        signal: AbortSignal.timeout(WORKER_HEALTH_CHECK_TIMEOUT_MS),
      });

      if (response.ok) {
        const health = await response.json();
        const parsedHealth = parseOrchestratorHealthContract(health);
        if (parsedHealth.ok) {
          testStatus = 'success';
          testMessage = 'Connection successful';
        } else if (hasLegacyCapacityHealth(health)) {
          testMessage = `Health response missing worker capability details: ${parsedHealth.missingFields.join(', ')}`;
        } else {
          testMessage = 'Invalid health response format';
        }
      } else {
        testMessage = `HTTP ${String(response.status)}: ${response.statusText}`;
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      testMessage = `Connection failed: ${errorMessage}`;
      logger.warn({ userId, workerName, error: errorMessage }, 'Worker connectivity test failed');
    }

    await workerSettingsRepo.updateTestResult(userId, workerName, {
      status: testStatus,
      message: testMessage,
    });

    logger.info({ userId, workerName, testStatus }, 'Worker connectivity test completed');

    return ok({ testStatus, testMessage, lastTestedAt });
  };
}
