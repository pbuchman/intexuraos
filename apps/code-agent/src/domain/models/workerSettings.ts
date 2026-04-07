/**
 * Domain models for per-user worker settings.
 *
 * Enables users to configure their own worker endpoints (any machine running orchestrator)
 * with per-user encrypted credentials.
 */

import type { CodeTaskWorkerType } from '@intexuraos/common-core';

/**
 * Worker name validation regex.
 * Rules: 3-32 chars, lowercase alphanumeric + hyphens, must start/end with alphanumeric.
 * Valid: "home-mac", "office-pc", "worker1"
 * Invalid: "-worker", "worker-", "ab", "UPPERCASE"
 */
export const WORKER_NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Maximum number of workers per user.
 * Enforced at API level.
 */
export const MAX_WORKERS_PER_USER = 2;

/**
 * Validates a worker name against the naming rules.
 * @param name - The worker name to validate
 * @returns true if valid, false otherwise
 */
export function isValidWorkerName(name: string): boolean {
  return WORKER_NAME_REGEX.test(name);
}

/**
 * Configuration for a single worker.
 * Credentials are stored encrypted in Firestore.
 */
export interface WorkerConfig {
  /** User-defined worker name (e.g., "home-mac", "office-pc") */
  name: string;
  /** Worker URL (e.g., "https://cc-mac.intexuraos.cloud") */
  url: string;
  /** Cloudflare Access Client ID for this worker */
  cfAccessClientId: string;
  /** Cloudflare Access Client Secret for this worker */
  cfAccessClientSecret: string;
  /** HMAC signing secret - must match DISPATCH_SECRET on the orchestrator */
  dispatchSigningSecret: string;
  /** Whether this worker is enabled for dispatch */
  enabled: boolean;
  /** ISO timestamp of last connectivity test */
  lastTestedAt?: string;
  /** Result of last connectivity test */
  testStatus?: 'success' | 'failure';
  /** Message from last connectivity test */
  testMessage?: string;
}

/**
 * User's complete worker settings document.
 * Document ID = userId for direct access and isolation.
 */
export interface UserWorkerSettings {
  /** User ID (same as document ID) */
  userId: string;
  /** Ordered array of workers. Position = priority (first = primary). Max 2. */
  workers: WorkerConfig[];
  /** ISO timestamp of document creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Default worker type for review tasks (when not explicitly specified) */
  defaultReviewWorkerType?: CodeTaskWorkerType;
  /** Default worker type for remediation tasks (when not explicitly specified) */
  defaultRemediationWorkerType?: CodeTaskWorkerType;
  /** Default worker type for execution tasks (when not explicitly specified) */
  defaultExecutionWorkerType?: CodeTaskWorkerType;
  /** Default worker type for planning tasks (when not explicitly specified) */
  defaultPlanningWorkerType?: CodeTaskWorkerType;
  /** Default worker type for pull request tasks (when not explicitly specified) */
  defaultPullRequestWorkerType?: CodeTaskWorkerType;
  /** Cached health statuses for workers (name -> status) */
  workerHealthStatuses?: Record<string, WorkerHealthStatus>;
}

/**
 * Input for creating a new worker.
 * All fields required.
 */
export interface WorkerConfigInput {
  name: string;
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
}

/**
 * Input for updating an existing worker.
 * Only url and credentials can be updated (name is immutable).
 */
export interface WorkerConfigUpdateInput {
  url?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  dispatchSigningSecret?: string;
  enabled?: boolean;
}

/**
 * Masked version of worker config for API responses.
 * Secrets show only last 3 characters.
 */
export interface MaskedWorkerConfig {
  name: string;
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
  enabled: boolean;
  lastTestedAt?: string;
  testStatus?: 'success' | 'failure';
  testMessage?: string;
}

/**
 * API response for worker settings (secrets masked).
 */
export interface UserWorkerSettingsResponse {
  workers: MaskedWorkerConfig[];
  defaultReviewWorkerType?: CodeTaskWorkerType;
  defaultRemediationWorkerType?: CodeTaskWorkerType;
  defaultExecutionWorkerType?: CodeTaskWorkerType;
  defaultPlanningWorkerType?: CodeTaskWorkerType;
  defaultPullRequestWorkerType?: CodeTaskWorkerType;
}

/**
 * Worker credentials resolved for dispatch.
 * These are the decrypted credentials ready to use.
 */
export interface WorkerCredentials {
  name: string;
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
}

/**
 * Health state of a worker with detailed failure reason.
 * Discriminated union using _tag for type narrowing.
 */
export type WorkerHealthState =
  | HealthyState
  | OrchestratorUnreachableState
  | TunnelDownState
  | UnknownState;

/**
 * Worker is healthy and responding.
 */
export interface HealthyState {
  _tag: 'healthy';
  healthy: true;
  capacity: number;
  running: number;
  available: number;
  responseTimeMs: number;
}

/**
 * Orchestrator is not responding (but tunnel is up).
 */
export interface OrchestratorUnreachableState {
  _tag: 'orchestrator-unreachable';
  healthy: false;
  reason: 'timeout' | 'http-error';
  code?: string;
}

/**
 * Cloudflare tunnel or network is down.
 */
export interface TunnelDownState {
  _tag: 'tunnel-down';
  healthy: false;
  reason: 'dns-failed' | 'connection-refused' | 'tls-error' | 'cf-error';
  code?: string;
}

/**
 * Unknown error occurred during health check.
 */
export interface UnknownState {
  _tag: 'unknown';
  healthy: false;
  error: string;
}

/**
 * Health status cache stored in Firestore.
 */
export interface WorkerHealthStatus {
  state: WorkerHealthState;
  checkedAt: string;
  stale: boolean;
}
