/**
 * Configuration loader for linear-agent service.
 */

export interface Config {
  port: number;
  gcpProjectId: string;
  userServiceUrl: string;
  internalAuthToken: string;
}

/** Configuration for the issue pruning system */
export const PRUNE_CONFIG = {
  /** Threshold above which pruning activates */
  ACTIVATION_THRESHOLD: 200,
  /** Target number of issues to delete per run */
  TARGET_DELETION_COUNT: 30,
} as const satisfies { readonly ACTIVATION_THRESHOLD: number; readonly TARGET_DELETION_COUNT: number } & Record<string, number>;

/** PruneConfig adapter - converts PRUNE_CONFIG to PruneConfig interface format */
export const PRUNE_CONFIG_RUNTIME = {
  activationThreshold: PRUNE_CONFIG.ACTIVATION_THRESHOLD,
  targetDeletionCount: PRUNE_CONFIG.TARGET_DELETION_COUNT,
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
