import crypto from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { FastifyRequest } from 'fastify';

export type WebhookAuthError =
  | { code: 'missing_signature'; message: string }
  | { code: 'missing_timestamp'; message: string }
  | { code: 'invalid_timestamp_format'; message: string }
  | { code: 'expired_signature'; message: string }
  | { code: 'invalid_signature'; message: string };

export interface OrchestratorValidationDeps {
  orchestratorSecret: string;
}

/**
 * Validate orchestrator signature using shared secret.
 *
 * Process:
 * 1. Extract X-Request-Timestamp and X-Request-Signature headers
 * 2. Validate timestamp within 15 minutes (replay protection)
 * 3. Compute HMAC-SHA256 using orchestratorSecret with timing-safe comparison
 */
export function validateOrchestratorSignature(
  request: FastifyRequest,
  deps: OrchestratorValidationDeps,
): Result<void, WebhookAuthError> {
  const timestamp = request.headers['x-request-timestamp'];
  const signature = request.headers['x-request-signature'];

  if (timestamp === undefined) {
    return err({ code: 'missing_timestamp', message: 'Missing X-Request-Timestamp header' });
  }
  if (signature === undefined) {
    return err({ code: 'missing_signature', message: 'Missing X-Request-Signature header' });
  }

  const timestampInt = parseInt(String(timestamp), 10);
  if (Number.isNaN(timestampInt)) {
    return err({ code: 'invalid_timestamp_format', message: 'Invalid timestamp format' });
  }

  const now = Math.floor(Date.now() / 1000);
  const timestampAge = Math.abs(now - timestampInt);
  const fifteenMinutes = 15 * 60;

  if (timestampAge > fifteenMinutes) {
    return err({
      code: 'expired_signature',
      message: `Signature expired (timestamp age: ${String(timestampAge)}s, max: ${String(fifteenMinutes)}s)`,
    });
  }

  const rawBody = JSON.stringify(request.body);
  /* v8 ignore start -- upstream: Fastify always produces non-empty header arrays — cannot simulate empty Array.isArray-true header @preserve */
  const timestampStr = Array.isArray(timestamp) ? timestamp[0] ?? '' : timestamp;
  /* v8 ignore stop @preserve */
  const message = `${timestampStr}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', deps.orchestratorSecret)
    .update(message)
    .digest('hex');

  const receivedBuffer = Buffer.from(String(signature), 'utf-8');
  const expectedBuffer = Buffer.from(expected, 'utf-8');

  if (receivedBuffer.length !== expectedBuffer.length) {
    return err({ code: 'invalid_signature', message: 'Signature length mismatch' });
  }

  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return err({ code: 'invalid_signature', message: 'HMAC signature verification failed' });
  }

  return ok(undefined);
}
