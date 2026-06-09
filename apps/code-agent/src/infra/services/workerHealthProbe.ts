/**
 * Worker health probe implementation.
 *
 * Distinguishes between tunnel failures (DNS, connection refused, TLS)
 * and orchestrator failures (timeout after connection, HTTP 5xx).
 */

import { createAppLogger } from '@intexuraos/infra-sentry';
import { getErrorMessage } from '@intexuraos/common-core';
import { performHttpFetch } from '@intexuraos/common-http';
import type { Logger } from 'pino';
import type { WorkerConfig } from '../../domain/models/workerSettings.js';
import type {
  ProviderApiKeyStatus,
  WorkerAuthProvider,
  WorkerAuthStatusDetails,
  WorkerHealthState,
} from '../../domain/models/workerSettings.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';

const PROBE_TIMEOUT_MS = 5000;
const REQUIRED_HEALTH_FIELDS = [
  'status',
  'capacity',
  'running',
  'available',
  'workerAuths',
  'providerApiKeys',
  'dockerHealthy',
  'diskHealthy',
] as const;

/**
 * Helper type for building tunnel-down state with optional code.
 */
interface TunnelDownStateResult {
  _tag: 'tunnel-down';
  healthy: false;
  reason: 'dns-failed' | 'connection-refused' | 'tls-error' | 'cf-error';
  code?: string;
}

/**
 * Expected orchestrator health response format.
 */
interface OrchestratorHealthResponse {
  status: string;
  capacity: number;
  running: number;
  available: number;
  workerAuths: Record<string, unknown>;
  providerApiKeys: Record<string, { configured: boolean }>;
  dockerHealthy: boolean;
  diskHealthy: boolean;
}

export class WorkerHealthProbeImpl implements WorkerHealthProbe {
  private readonly logger: Logger;

  constructor() {
    this.logger = createAppLogger({ name: 'worker-health-probe' });
  }

  async probeWorker(worker: WorkerConfig): Promise<WorkerHealthState> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, PROBE_TIMEOUT_MS);

    try {
      this.logger.info({ worker: worker.name }, 'Probing worker health');

      const response = await performHttpFetch(`${worker.url}/health`, {
        method: 'GET',
        headers: {
          'CF-Access-Client-Id': worker.cfAccessClientId,
          'CF-Access-Client-Secret': worker.cfAccessClientSecret,
          'User-Agent': 'intexuraos-code-agent/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const responseTimeMs = Date.now() - startTime;

      if (!response.ok) {
        if (response.status >= 500) {
          this.logger.info(
            { worker: worker.name, status: response.status },
            'Orchestrator returned server error'
          );
          return {
            _tag: 'orchestrator-unreachable',
            healthy: false,
            reason: 'http-error',
            code: String(response.status),
          };
        }

        return {
          _tag: 'orchestrator-unreachable',
          healthy: false,
          reason: 'http-error',
          code: String(response.status),
        };
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return {
          _tag: 'unknown',
          healthy: false,
          error: 'Invalid health response format',
        };
      }

      if (this.isValidOrchestratorHealth(data)) {
        this.logger.info(
          { worker: worker.name, capacity: data.capacity, available: data.available },
          'Worker is healthy'
        );
        return {
          _tag: 'healthy',
          healthy: true,
          capacity: data.capacity,
          running: data.running,
          available: data.available,
          workerAuths: data.workerAuths as Record<WorkerAuthProvider, WorkerAuthStatusDetails>,
          providerApiKeys: data.providerApiKeys as Record<string, ProviderApiKeyStatus>,
          dockerHealthy: data.dockerHealthy,
          diskHealthy: data.diskHealthy,
          responseTimeMs,
        };
      }

      if (this.isLegacyCapacityHealth(data)) {
        const missingFields = this.missingHealthFields(data);
        return {
          _tag: 'unknown',
          healthy: false,
          error: 'Health response missing worker capability details',
          contractMismatch: true,
          missingFields,
        };
      }

      return {
        _tag: 'unknown',
        healthy: false,
        error: 'Invalid health response format',
      };
    } catch (error) {
      clearTimeout(timeout);

      const errorMessage = getErrorMessage(error);
      const errorCode = (error as { code?: string }).code;

      this.logger.error({ worker: worker.name, error: errorMessage }, 'Health probe failed');

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          _tag: 'orchestrator-unreachable',
          healthy: false,
          reason: 'timeout',
        };
      }

      if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'].includes(errorCode ?? '')) {
        const result: TunnelDownStateResult = {
          _tag: 'tunnel-down',
          healthy: false,
          reason: errorCode === 'ENOTFOUND' ? 'dns-failed' : 'connection-refused',
        };
        /* v8 ignore start -- upstream: FakeHttpClient error codes always match includes() — cannot produce undefined errorCode inside match block @preserve */
        if (errorCode !== undefined) {
          result.code = errorCode;
        }
        /* v8 ignore stop @preserve */
        return result;
      }

      if (errorMessage.includes('TLS') || errorMessage.includes('certificate')) {
        const result: TunnelDownStateResult = {
          _tag: 'tunnel-down',
          healthy: false,
          reason: 'tls-error',
        };
        if (errorCode !== undefined) {
          result.code = errorCode;
        } else {
          result.code = 'TLS_ERROR';
        }
        return result;
      }

      return {
        _tag: 'unknown',
        healthy: false,
        error: errorMessage,
      };
    }
  }

  async probeAllWorkers(workers: WorkerConfig[]): Promise<Record<string, WorkerHealthState>> {
    const results: Record<string, WorkerHealthState> = {};

    const probePromises = workers.map(async (worker) => {
      const state = await this.probeWorker(worker);
      return { name: worker.name, state };
    });

    const probeResults = await Promise.all(probePromises);

    for (const { name, state } of probeResults) {
      results[name] = state;
    }

    return results;
  }

  private isValidOrchestratorHealth(data: unknown): data is OrchestratorHealthResponse {
    return (
      typeof data === 'object' &&
      data !== null &&
      'status' in data &&
      data.status === 'ready' &&
      'capacity' in data &&
      typeof data.capacity === 'number' &&
      'running' in data &&
      typeof data.running === 'number' &&
      'available' in data &&
      typeof data.available === 'number' &&
      'workerAuths' in data &&
      typeof data.workerAuths === 'object' &&
      data.workerAuths !== null &&
      'providerApiKeys' in data &&
      typeof data.providerApiKeys === 'object' &&
      data.providerApiKeys !== null &&
      'dockerHealthy' in data &&
      typeof data.dockerHealthy === 'boolean' &&
      'diskHealthy' in data &&
      typeof data.diskHealthy === 'boolean'
    );
  }

  private isLegacyCapacityHealth(data: unknown): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      'status' in data &&
      data.status === 'ready' &&
      'capacity' in data &&
      typeof data.capacity === 'number' &&
      'running' in data &&
      typeof data.running === 'number' &&
      'available' in data &&
      typeof data.available === 'number'
    );
  }

  private missingHealthFields(data: unknown): string[] {
    /* v8 ignore start -- ts-type: typeof/null narrowing fallback is defensive for malformed upstream JSON; object health response branches are covered @preserve */
    if (typeof data !== 'object' || data === null) {
      return [...REQUIRED_HEALTH_FIELDS];
    }
    /* v8 ignore stop @preserve */
    const record = data as Record<string, unknown>;

    return REQUIRED_HEALTH_FIELDS.filter((field) => {
      if (!(field in record)) {
        return true;
      }
      const value = record[field];
      if (field === 'status') return value !== 'ready';
      if (field === 'capacity' || field === 'running' || field === 'available') {
        return typeof value !== 'number';
      }
      if (field === 'dockerHealthy' || field === 'diskHealthy') {
        return typeof value !== 'boolean';
      }
      return typeof value !== 'object' || value === null;
    });
  }
}

/**
 * Factory function to create the worker health probe service.
 */
export function createWorkerHealthProbe(): WorkerHealthProbe {
  return new WorkerHealthProbeImpl();
}
