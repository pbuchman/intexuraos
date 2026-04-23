/**
 * Helpers for masking worker credentials in API responses and validating
 * that client-submitted credentials have not been sent back as masked values.
 *
 * These utilities are response/input-layer concerns shared by multiple worker
 * settings route plugins.
 */

import type { WorkerConfig, MaskedWorkerConfig } from '../models/workerSettings.js';

/** Bullet character used to mask secrets in responses. */
export const MASK_CHAR = '•';

/**
 * Check if a credential appears to be a masked value.
 *
 * Masked values contain bullet characters (•) from our maskSecret function.
 * These should never be stored — they indicate the frontend sent back
 * display-only data instead of a real credential.
 */
export function isMaskedCredential(value: string): boolean {
  return value.includes(MASK_CHAR);
}

/**
 * Validate that none of the provided credentials are masked values.
 *
 * @returns human-readable error message naming the offending field, or
 *          `undefined` when every provided credential is non-masked.
 */
export function validateCredentialsNotMasked(
  credentials: Partial<{
    cfAccessClientId: string;
    cfAccessClientSecret: string;
    dispatchSigningSecret: string;
  }>
): string | undefined {
  if (
    credentials.cfAccessClientId !== undefined &&
    isMaskedCredential(credentials.cfAccessClientId)
  ) {
    return 'CF Access Client ID contains masked characters - please enter the actual credential';
  }
  if (
    credentials.cfAccessClientSecret !== undefined &&
    isMaskedCredential(credentials.cfAccessClientSecret)
  ) {
    return 'CF Access Client Secret contains masked characters - please enter the actual credential';
  }
  if (
    credentials.dispatchSigningSecret !== undefined &&
    isMaskedCredential(credentials.dispatchSigningSecret)
  ) {
    return 'Orchestrator Secret contains masked characters - please enter the actual credential';
  }
  return undefined;
}

/**
 * Mask a secret string for API response.
 *
 * Shows only the last 3 characters. Secrets of length ≤ 3 are rendered as
 * three bullets to avoid leaking their full value.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 3) {
    return MASK_CHAR.repeat(3);
  }
  return MASK_CHAR.repeat(Math.min(secret.length - 3, 20)) + secret.slice(-3);
}

/**
 * Convert a stored worker config to its masked representation for API
 * responses. Optional test-result fields are only present when set.
 */
export function maskWorkerConfig(config: WorkerConfig): MaskedWorkerConfig {
  const masked: MaskedWorkerConfig = {
    name: config.name,
    url: config.url,
    cfAccessClientId: maskSecret(config.cfAccessClientId),
    cfAccessClientSecret: maskSecret(config.cfAccessClientSecret),
    dispatchSigningSecret: maskSecret(config.dispatchSigningSecret),
    enabled: config.enabled,
  };

  if (config.lastTestedAt !== undefined) {
    masked.lastTestedAt = config.lastTestedAt;
  }
  if (config.testStatus !== undefined) {
    masked.testStatus = config.testStatus;
  }
  if (config.testMessage !== undefined) {
    masked.testMessage = config.testMessage;
  }

  return masked;
}
