/**
 * Worker discovery service interface.
 *
 * Checks worker health and finds available workers for task dispatch.
 */

import type { WorkerConfig, WorkerHealth, WorkerLocation, WorkerError } from '../models/worker.js';
import type { Result, Logger } from '@intexuraos/common-core';

/**
 * Dependencies for worker discovery service.
 */
export interface WorkerDiscoveryDeps {
  logger: Logger;
}

/**
 * Worker discovery service interface.
 */
export interface WorkerDiscoveryService {
  /**
   * Check health of a specific worker.
   *
   * Calls GET /health on worker URL and returns health status.
   * Results are cached for 5 seconds to avoid overwhelming workers.
   *
   * @param location - Worker location to check
   * @returns Worker health status or error
   */
  checkHealth(location: WorkerLocation): Promise<Result<WorkerHealth, WorkerError>>;

  /**
   * Find an available worker for task dispatch.
   *
   * Worker selection flow:
   * 1. Check Mac health first (priority 1)
   * 2. If Mac has capacity > 0, return Mac config
   * 3. If Mac unavailable or full, check VM
   * 4. If VM has capacity > 0, return VM config
   * 5. If both unavailable or full, return error
   *
   * @returns Available worker config or error
   */
  findAvailableWorker(): Promise<Result<WorkerConfig, WorkerError>>;
}
