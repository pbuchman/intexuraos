/**
 * Sentry webhook signature verification.
 *
 * Sentry sends `Sentry-Hook-Signature` as a raw 64-character HMAC-SHA256 hex
 * digest generated with the integration client secret.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const EXPECTED_DIGEST_LENGTH = 32;

export function parseSentrySignature(signature: string): Buffer | null {
  if (signature.length !== EXPECTED_DIGEST_LENGTH * 2) {
    return null;
  }
  if (!/^[0-9a-fA-F]+$/.test(signature)) {
    return null;
  }

  try {
    return Buffer.from(signature, 'hex');
  } catch {
    return null;
  }
}

export function verifySentrySignature(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  const receivedDigest = parseSentrySignature(signature);
  if (receivedDigest === null) {
    return false;
  }

  const expectedDigest = createHmac('sha256', secret).update(payload).digest();

  /* v8 ignore start -- upstream: parseSentrySignature enforces 32-byte hex and HMAC-SHA256 always returns 32 bytes @preserve */
  if (receivedDigest.length !== expectedDigest.length) {
    return false;
  }
  /* v8 ignore stop @preserve */

  return timingSafeEqual(expectedDigest, receivedDigest);
}
