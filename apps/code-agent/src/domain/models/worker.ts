/**
 * Worker discovery and health check domain models.
 */

/**
 * Worker location type - Mac is primary, VM is fallback.
 */
export type WorkerLocation = 'mac' | 'vm';

/**
 * Worker configuration loaded from environment.
 */
export interface WorkerConfig {
  /** Worker location (Mac or VM) */
  location: WorkerLocation;
  /** Worker URL for health checks and task dispatch */
  url: string;
  /** Priority: 1 = primary (Mac), 2 = fallback (VM) */
  priority: number;
}

/**
 * Worker health status from health check endpoint.
 */
export interface WorkerHealth {
  /** Worker location (Mac or VM) */
  location: WorkerLocation;
  /** Whether worker is healthy and ready for tasks */
  healthy: boolean;
  /** Available task slots (0-5) */
  capacity: number;
  /** When health check was performed */
  checkedAt: Date;
}

/**
 * Worker error types for worker discovery failures.
 */
export interface WorkerError {
  code:
    | 'worker_unavailable'
    | 'worker_unhealthy'
    | 'health_check_failed'
    | 'invalid_response'
    | 'network_error';
  message: string;
}
