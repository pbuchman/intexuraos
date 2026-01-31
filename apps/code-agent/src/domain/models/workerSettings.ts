/**
 * Domain models for per-user worker settings.
 *
 * Enables users to configure their own worker endpoints (any machine running orchestrator)
 * with per-user encrypted credentials.
 */

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
