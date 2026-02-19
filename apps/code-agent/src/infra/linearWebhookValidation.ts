/**
 * Linear webhook signature validation utility.
 *
 * Validates HMAC-SHA256 signatures from Linear webhooks.
 * Linear sends signatures in the Linear-Signature header as hex-encoded HMAC-SHA256.
 *
 * Reference: https://linear.app/developers/webhooks
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Maximum age for webhook timestamps (60 seconds).
 * Prevents replay attacks.
 */
const MAX_TIMESTAMP_AGE_MS = 60_000;

/**
 * Validate a Linear webhook signature.
 *
 * Process:
 * 1. Compute HMAC-SHA256 of the raw body using the webhook secret
 * 2. Compare with the Linear-Signature header using timing-safe comparison
 *
 * @param rawBody - Raw request body as string
 * @param signature - Linear-Signature header value (hex-encoded HMAC-SHA256)
 * @param secret - Linear webhook signing secret
 * @returns true if signature is valid, false otherwise
 */
export function validateLinearWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (signature === '' || secret === '') {
    return false;
  }

  // Compute expected HMAC-SHA256
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Convert to buffers for timing-safe comparison
  const receivedBuffer = Buffer.from(signature, 'utf-8');
  const expectedBuffer = Buffer.from(expected, 'utf-8');

  // Length check before timingSafeEqual (required - different lengths cause error)
  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

/**
 * Validate a webhook timestamp is within the acceptable window.
 *
 * Linear includes a `webhookTimestamp` field in milliseconds.
 * Reject timestamps older than 60 seconds to prevent replay attacks.
 *
 * @param webhookTimestamp - UNIX timestamp in milliseconds from webhook payload
 * @returns true if timestamp is within acceptable window
 */
export function validateWebhookTimestamp(webhookTimestamp: number): boolean {
  const now = Date.now();
  const age = Math.abs(now - webhookTimestamp);
  return age <= MAX_TIMESTAMP_AGE_MS;
}
