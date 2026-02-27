/**
 * Shared secrets utilities for webhook secrets and cancel nonces.
 *
 * Extracted from duplicated implementations across use-case files.
 * See INT-614 for context.
 */

import { createHmac, randomBytes } from 'node:crypto';

/**
 * Cancel nonce TTL in milliseconds (15 minutes).
 */
export const CANCEL_NONCE_TTL_MS = 15 * 60 * 1000;

/**
 * Generate a deterministic webhook secret for a task.
 *
 * Derives from HMAC-SHA256(sharedSecret, taskId) so both code-agent
 * and orchestrator can independently compute the same value without shared state.
 *
 * @param sharedSecret - The shared INTEXURAOS_ORCHESTRATOR_SECRET
 * @param taskId - The task identifier
 * @returns Deterministic 64-character lowercase hex string
 */
export function generateWebhookSecret(sharedSecret: string, taskId: string): string {
  return createHmac('sha256', sharedSecret).update(taskId).digest('hex');
}

/**
 * Generate a cancel nonce for task cancellation (INT-379).
 *
 * Uses 4 bytes (8 hex characters) for sufficient uniqueness.
 * This is the standardized length across all use cases.
 *
 * @returns 8-character hex string
 */
export function generateCancelNonce(): string {
  const buffer = randomBytes(4);
  return buffer.toString('hex');
}
