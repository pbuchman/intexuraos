/**
 * Configuration loader for linear-agent service.
 */

import type { PruneConfig } from './domain/index.js';

export interface Config {
  port: number;
  gcpProjectId: string;
  userServiceUrl: string;
  internalAuthToken: string;
}

/** Configuration for the issue pruning system */
export const PRUNE_CONFIG: PruneConfig = {
  activationThreshold: 200,
  targetDeletionCount: 30,
} as const;

export function loadConfig(): Config {
  const port = Number(process.env['PORT'] ?? 8080);
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

  return {
    port,
    gcpProjectId,
    userServiceUrl,
    internalAuthToken,
  };
}
