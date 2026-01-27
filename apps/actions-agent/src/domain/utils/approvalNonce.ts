/**
 * Approval Nonce Utility
 *
 * Generates and validates approval nonces for code action approvals.
 * Nonces are 4-character hex strings used to prevent ambiguous approvals.
 */

import { randomBytes } from 'node:crypto';

const NONCE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Generates a 4-character hex nonce for approval.
 * Uses crypto.randomBytes for cryptographic randomness.
 *
 * @returns A 4-character hex string (e.g., "a3f2")
 */
export function generateApprovalNonce(): string {
  return randomBytes(2).toString('hex');
}

/**
 * Generates the expiration timestamp for an approval nonce.
 * Nonces expire after 15 minutes.
 *
 * @returns ISO 8601 timestamp string
 */
export function generateNonceExpiration(): string {
  return new Date(Date.now() + NONCE_TTL_MS).toISOString();
}

/**
 * Checks if a nonce has expired.
 *
 * @param expirationTimestamp - The nonce expiration timestamp (ISO 8601)
 * @returns true if the nonce has expired
 */
export function isNonceExpired(expirationTimestamp: string): boolean {
  return new Date(expirationTimestamp) < new Date();
}

/**
 * Validates a nonce against an action's nonce.
 *
 * @param actionNonce - The nonce stored on the action
 * @param providedNonce - The nonce provided by the user
 * @returns true if the nonces match
 */
export function validateNonce(actionNonce: string | undefined, providedNonce: string): boolean {
  return actionNonce === providedNonce;
}
