/**
 * Domain models for per-user worker settings.
 *
 * Enables users to configure their own Mac and VM worker endpoints
 * with per-user encrypted credentials.
 */

export type WorkerType = 'mac' | 'vm';

/**
 * Configuration for a single worker (Mac or VM).
 * Credentials are stored encrypted in Firestore.
 */
export interface WorkerConfig {
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
 * User's complete worker settings document.
 * Document ID = userId for direct access and isolation.
 */
export interface UserWorkerSettings {
  userId: string;
  mac?: WorkerConfig;
  vm?: WorkerConfig;
  workerPriority?: WorkerType[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating/updating a worker config.
 * All credential fields are required for create, optional for update.
 */
export interface WorkerConfigInput {
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
  enabled?: boolean;
}

/**
 * Masked version of worker config for API responses.
 * Secrets show only last 3 characters.
 */
export interface MaskedWorkerConfig {
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
  mac?: MaskedWorkerConfig;
  vm?: MaskedWorkerConfig;
  workerPriority?: WorkerType[];
}

/**
 * Worker credentials resolved for dispatch.
 * These are the decrypted credentials ready to use.
 */
export interface WorkerCredentials {
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
}
