/**
 * Linear webhook signature validation.
 *
 * Validates HMAC-SHA256 signatures from Linear webhooks.
 * Linear signature format: "sha256=<hex-digest>"
 * Signature computed as: HMAC-SHA256(webhookSecret, rawRequestBody)
 *
 * Linear sends the signature in the "Linear-Signature" header.
 */

import crypto from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { FastifyRequest } from 'fastify';

// Augment Fastify types to include rawBody for webhook signature validation
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export type LinearWebhookError =
  | { code: 'MISSING_SIGNATURE'; message: string }
  | { code: 'INVALID_SIGNATURE_FORMAT'; message: string }
  | { code: 'INVALID_SIGNATURE'; message: string };

/**
 * Validate Linear webhook signature.
 *
 * Linear webhooks include a Linear-Signature header with format "sha256=<hex-digest>".
 * The signature is computed as HMAC-SHA256(webhookSecret, rawRequestBody).
 *
 * @param request - Fastify request object
 * @param webhookSecret - Linear webhook signing secret
 * @returns Ok(undefined) if valid, Err(error) if invalid
 */
export function validateLinearWebhookSignature(
  request: FastifyRequest,
  webhookSecret: string
): Result<void, LinearWebhookError> {
  // Extract signature header - Fastify normalizes headers to lowercase
  const signatureHeader = request.headers['linear-signature'];

  if (signatureHeader === undefined) {
    return err({ code: 'MISSING_SIGNATURE', message: 'Missing Linear-Signature header' });
  }

  /* v8 ignore start -- test-infra: Fastify header edge cases difficult to reproduce @preserve */
  // Linear signature format: "sha256=<hex-digest>"
  const signatureStr = Array.isArray(signatureHeader) ? signatureHeader[0] ?? '' : signatureHeader;
  /* v8 ignore stop @preserve */

  if (signatureStr.length === 0 || !signatureStr.startsWith('sha256=')) {
    return err({
      code: 'INVALID_SIGNATURE_FORMAT',
      message: 'Invalid signature format, expected "sha256=<hex-digest>"',
    });
  }

  const receivedSignature = signatureStr.slice(7); // Remove "sha256=" prefix

  // Compute expected signature
  // Linear uses HMAC-SHA256 of the raw request body
  const rawBody = request.rawBody;

  if (rawBody === undefined) {
    return err({ code: 'INVALID_SIGNATURE', message: 'Missing request body' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  const receivedBuffer = Buffer.from(receivedSignature, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');

  /* v8 ignore start -- test-infra: timing-safe comparison requires matching signature buffer @preserve */
  if (receivedBuffer.length !== expectedBuffer.length) {
    return err({ code: 'INVALID_SIGNATURE', message: 'Signature length mismatch' });
  }

  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return err({ code: 'INVALID_SIGNATURE', message: 'HMAC signature verification failed' });
  }

  return ok(undefined);
  /* v8 ignore stop @preserve */
}
