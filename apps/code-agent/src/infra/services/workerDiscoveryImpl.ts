/**
 * Worker discovery service implementation.
 *
 * Checks worker health via GET /health and manages 5-second cache.
 */

import { err, ok, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { WorkerConfig, WorkerHealth, WorkerLocation, WorkerError } from '../../domain/models/worker.js';
import type { WorkerDiscoveryDeps, WorkerDiscoveryService } from '../../domain/services/workerDiscovery.js';

/**
 * Worker health response from worker endpoint.
 */
interface WorkerHealthResponse {
  status: 'ready' | 'shutting_down';
  capacity: number;
}

/**
 * Parse INTEXURAOS_CODE_WORKERS env var.
 *
 * Format: "mac:url:priority,vm:url:priority"
 * Example: "mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2"
 */
function parseWorkerConfig(envValue: string): WorkerConfig[] {
  const workers: WorkerConfig[] = [];

  for (const part of envValue.split(',')) {
    // Split on first colon for location
    const firstColonIndex = part.indexOf(':');
    if (firstColonIndex === -1) continue;

    const location = part.slice(0, firstColonIndex);
    const rest = part.slice(firstColonIndex + 1);

    // Split on last colon for priority
    const lastColonIndex = rest.lastIndexOf(':');
    if (lastColonIndex === -1) continue;

    const url = rest.slice(0, lastColonIndex);
    const priority = rest.slice(lastColonIndex + 1);

    if (location === 'mac' || location === 'vm') {
      workers.push({
        location: location as WorkerLocation,
        url,
        priority: parseInt(priority, 10),
      });
    }
  }

  // Sort by priority (lower = preferred)
  workers.sort((a, b) => a.priority - b.priority);

  return workers;
}

/**
 * Worker discovery service implementation with health check caching.
 */
class WorkerDiscoveryImpl implements WorkerDiscoveryService {
  private readonly logger: WorkerDiscoveryDeps['logger'];
  private readonly workers: WorkerConfig[];
  private readonly healthCache: Map<WorkerLocation, { health: WorkerHealth; expiresAt: number }>;
  private readonly CACHE_TTL_MS = 5000; // 5 seconds

  constructor(deps: WorkerDiscoveryDeps, codeWorkersEnv: string) {
    this.logger = deps.logger;
    this.workers = parseWorkerConfig(codeWorkersEnv);
    this.healthCache = new Map();
    this.logger = deps.logger;
    this.workers = parseWorkerConfig(codeWorkersEnv);
  }

  async checkHealth(location: WorkerLocation): Promise<Result<WorkerHealth, WorkerError>> {
    const config = this.workers.find((w) => w.location === location);
    if (!config) {
      return err({
        code: 'worker_unavailable',
        message: `No configuration found for worker: ${location}`,
      });
    }

    // Check cache first
    const cached = this.healthCache.get(location);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      this.logger.debug(
        { location, capacity: cached.health.capacity },
        'Returning cached worker health'
      );
      return ok(cached.health);
    }

    // Perform health check
    this.logger.info({ location, url: config.url }, 'Checking worker health');

    try {
      const response = await fetch(`${config.url}/health`, {
        headers: {
          'CF-Access-Client-Id': process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] ?? '',
          'CF-Access-Client-Secret': process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] ?? '',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        this.logger.warn(
          { location, status: response.status },
          'Worker health check failed'
        );
        return err({
          code: 'health_check_failed',
          message: `Health check failed with HTTP ${String(response.status)}`,
        });
      }

      const data = (await response.json()) as WorkerHealthResponse;

      const health: WorkerHealth = {
        location,
        healthy: data.status === 'ready' && data.capacity > 0,
        capacity: Math.max(0, Math.min(5, data.capacity)), // Clamp to 0-5 range
        checkedAt: new Date(),
      };

      // Cache for 5 seconds
      this.healthCache.set(location, {
        health,
        expiresAt: now + this.CACHE_TTL_MS,
      });

      this.logger.info(
        { location, healthy: health.healthy, capacity: health.capacity },
        'Worker health check completed'
      );

      return ok(health);
    } catch (error) {
      this.logger.error({ location, error }, 'Worker health check threw error');

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return err({
            code: 'health_check_failed',
            message: 'Health check timed out after 10 seconds',
          });
        }

        if (error.cause instanceof Error && error.cause.name === 'AbortError') {
          return err({
            code: 'health_check_failed',
            message: 'Health check timed out after 10 seconds',
          });
        }
      }

      return err({
        code: 'network_error',
        message: `Network error: ${getErrorMessage(error)}`,
      });
    }
  }

  async findAvailableWorker(): Promise<Result<WorkerConfig, WorkerError>> {
    // Try workers in priority order (already sorted)
    for (const config of this.workers) {
      const healthResult = await this.checkHealth(config.location);

      if (!healthResult.ok) {
        this.logger.warn(
          { location: config.location, error: healthResult.error },
          'Worker health check failed, trying next worker'
        );
        continue;
      }

      const health = healthResult.value;

      if (health.healthy && health.capacity > 0) {
        this.logger.info(
          { location: config.location, capacity: health.capacity },
          'Found available worker'
        );
        return ok(config);
      }

      this.logger.info(
        { location: config.location, healthy: health.healthy, capacity: health.capacity },
        'Worker unavailable or at capacity'
      );
    }

    return err({
      code: 'worker_unavailable',
      message: 'No workers available (all unhealthy or at capacity)',
    });
  }
}

/**
 * Factory function to create worker discovery service.
 */
export function createWorkerDiscoveryService(
  deps: WorkerDiscoveryDeps
): WorkerDiscoveryService {
  const codeWorkersEnv = process.env['INTEXURAOS_CODE_WORKERS'];
  if (codeWorkersEnv === undefined || codeWorkersEnv === '') {
    throw new Error('INTEXURAOS_CODE_WORKERS environment variable is required');
  }

  return new WorkerDiscoveryImpl(deps, codeWorkersEnv);
}
