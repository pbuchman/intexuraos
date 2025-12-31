/**
 * Health check utilities for IntexuraOS services.
 */

import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';

/**
 * Health status values.
 */
export type HealthStatus = 'ok' | 'degraded' | 'down';

/**
 * Individual health check result.
 */
export interface HealthCheck {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  details: Record<string, unknown> | null;
}

/**
 * Health check response structure.
 */
export interface HealthResponse {
  status: HealthStatus;
  serviceName: string;
  version: string;
  timestamp: string;
  checks: HealthCheck[];
}

/**
 * Check required environment variables.
 * Returns a health check result indicating if all required secrets are present.
 */
export function checkSecrets(required: string[]): HealthCheck {
  const start = Date.now();
  const missing = required.filter((k) => process.env[k] === undefined || process.env[k] === '');

  return {
    name: 'secrets',
    status: missing.length === 0 ? 'ok' : 'down',
    latencyMs: Date.now() - start,
    details: missing.length > 0 ? { missing } : null,
  };
}

/**
 * Validate required environment variables at startup.
 * Throws if any required variables are missing or empty.
 * Call this before buildServer() in index.ts to fail fast.
 */
export function validateRequiredEnv(required: string[]): void {
  const missing = required.filter((k) => process.env[k] === undefined || process.env[k] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `Ensure these are set in Terraform env_vars or .envrc.local for local development.`
    );
  }
}

/**
 * Check Firestore connectivity.
 * Skips actual check in test environment.
 */
export async function checkFirestore(): Promise<HealthCheck> {
  const start = Date.now();

  // Skip actual Firestore check in test environment
  if (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] !== undefined) {
    return {
      name: 'firestore',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: { note: 'Skipped in test environment' },
    };
  }

  try {
    const db = getFirestore();
    // Simple connectivity check with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout((): void => {
        reject(new Error('Firestore health check timed out'));
      }, 3000);
    });

    await Promise.race([db.listCollections(), timeoutPromise]);
    return {
      name: 'firestore',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: null,
    };
  } catch (error) {
    return {
      name: 'firestore',
      status: 'down',
      latencyMs: Date.now() - start,
      details: { error: getErrorMessage(error) },
    };
  }
}

/**
 * Passive check for Notion SDK availability.
 * Notion connections are per-user, so we can't actively test connectivity.
 */
export function checkNotionSdk(): HealthCheck {
  const start = Date.now();
  try {
    return {
      name: 'notion-sdk',
      status: 'ok',
      latencyMs: Date.now() - start,
      details: {
        mode: 'passive',
        reason: 'Notion credentials are per-user; API validated per-request',
      },
    };
  } catch /* istanbul ignore next -- defensive code, unreachable in normal execution */ {
    return {
      name: 'notion-sdk',
      status: 'down',
      latencyMs: Date.now() - start,
      details: { error: 'Notion SDK not available' },
    };
  }
}

/**
 * Compute overall health status from individual checks.
 */
export function computeOverallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'down';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

/**
 * Build a complete health response.
 */
export function buildHealthResponse(
  serviceName: string,
  version: string,
  checks: HealthCheck[]
): HealthResponse {
  return {
    status: computeOverallStatus(checks),
    serviceName,
    version,
    timestamp: new Date().toISOString(),
    checks,
  };
}
