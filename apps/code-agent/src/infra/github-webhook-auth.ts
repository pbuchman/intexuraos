/**
 * GitHub webhook signature verification.
 *
 * Validates HMAC-SHA256 signatures from GitHub webhooks.
 * GitHub sends signatures in the X-Hub-Signature-256 header with format: sha256=<hex-digest>
 *
 * Reference: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';
const EXPECTED_DIGEST_LENGTH = 32; // 256 bits = 32 bytes

/**
 * Parse GitHub signature header.
 *
 * Extracts the hex digest from X-Hub-Signature-256 header.
 * Returns null if the signature format is invalid.
 *
 * @param signature - Signature header value (e.g., "sha256=abc123...")
 * @returns Buffer containing the digest, or null if invalid
 */
export function parseGitHubSignature(signature: string): Buffer | null {
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return null;
  }

  const hexDigest = signature.slice(SIGNATURE_PREFIX.length);

  // Validate hex string length (256 bits = 64 hex chars)
  if (hexDigest.length !== EXPECTED_DIGEST_LENGTH * 2) {
    return null;
  }

  // Validate hex characters
  if (!/^[0-9a-fA-F]+$/.test(hexDigest)) {
    return null;
  }

  try {
    return Buffer.from(hexDigest, 'hex');
  } catch {
    return null;
  }
}

/**
 * Verify GitHub webhook signature.
 *
 * Compares the provided signature against an expected HMAC-SHA256 digest.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param payload - Raw request body as Buffer
 * @param signature - X-Hub-Signature-256 header value
 * @param secret - GitHub webhook secret
 * @returns true if signature is valid, false otherwise
 */
export function verifyGitHubSignature(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  const receivedDigest = parseGitHubSignature(signature);

  if (receivedDigest === null) {
    return false;
  }

  // Compute expected HMAC
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  const expectedDigest = hmac.digest();

  // Timing-safe comparison
  /* v8 ignore start -- upstream: HMAC-SHA256 digest and hex-parsed buffer are always 32 bytes @preserve */
  if (receivedDigest.length !== expectedDigest.length) {
    return false;
  }
  /* v8 ignore stop @preserve */

  return timingSafeEqual(expectedDigest, receivedDigest);
}
