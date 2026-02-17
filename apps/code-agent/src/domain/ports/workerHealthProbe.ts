/**
 * Port for worker health probe service.
 *
 * Probes worker /health endpoints to determine availability
 * and distinguish between tunnel failures and orchestrator failures.
 */

import type { WorkerConfig } from '../models/workerSettings.js';
import type { WorkerHealthState } from '../models/workerSettings.js';

export interface WorkerHealthProbe {
  /**
   * Probe a single worker's health endpoint.
   * Returns detailed health state with failure reason.
   */
  probeWorker(worker: WorkerConfig): Promise<WorkerHealthState>;

  /**
   * Probe all workers in parallel.
   * Returns a map of worker name to health state.
   */
  probeAllWorkers(workers: WorkerConfig[]): Promise<Record<string, WorkerHealthState>>;
}
