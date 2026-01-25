/**
 * Webhook signature validation utility.
 *
 * Validates HMAC-SHA256 signatures from orchestrator webhooks.
 * Design reference: Lines 1652-1662
 */

import crypto from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { FastifyRequest } from 'fastify';

export type AuthError =
  | { code: 'missing_signature'; message: string }
  | { code: 'missing_timestamp'; message: string }
  | { code: 'invalid_timestamp_format'; message: string }
  | { code: 'expired_signature'; message: string }
  | { code: 'unknown_task'; message: string }
  | { code: 'invalid_signature'; message: string };

export interface WebhookValidationDeps {
  getWebhookSecret: (taskId: string) => Promise<string | null>;
}

/**
 * Validate webhook signature from orchestrator.
 *
 * Process:
 * 1. Extract X-Request-Timestamp and X-Request-Signature headers
 * 2. Validate timestamp within 15 minutes (replay protection)
 * 3. Retrieve webhookSecret from task record
 * 4. Compute HMAC-SHA256 with timing-safe comparison
 *
 * @param request - Fastify request object
 * @param deps - Dependencies including webhook secret retrieval
 * @returns Ok(undefined) if valid, Err(error) if invalid
 */
export async function validateWebhookSignature(
  request: FastifyRequest,
  deps: WebhookValidationDeps
): Promise<Result<void, AuthError>> {
  // Extract headers
  const timestamp = request.headers['x-request-timestamp'];
  const signature = request.headers['x-request-signature'];

  // Check required headers exist
  if (timestamp === undefined) {
    return err({ code: 'missing_timestamp', message: 'Missing X-Request-Timestamp header' });
  }
  if (signature === undefined) {
    return err({ code: 'missing_signature', message: 'Missing X-Request-Signature header' });
  }

  // Parse timestamp
  const timestampInt = parseInt(String(timestamp), 10);
  if (Number.isNaN(timestampInt)) {
    return err({ code: 'invalid_timestamp_format', message: 'Invalid timestamp format' });
  }

  // Check timestamp within 15 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  const timestampAge = Math.abs(now - timestampInt);
  const fifteenMinutes = 15 * 60;

  if (timestampAge > fifteenMinutes) {
    return err({
      code: 'expired_signature',
      message: `Signature expired (timestamp age: ${String(timestampAge)}s, max: ${String(fifteenMinutes)}s)`,
    });
  }

  // Get task ID from body
  const body = request.body as { taskId: string } | undefined;
  const taskId = body?.taskId;

  if (taskId === undefined || taskId === '') {
    return err({ code: 'unknown_task', message: 'Missing taskId in request body' });
  }

  // Retrieve webhook secret from task record
  const webhookSecret = await deps.getWebhookSecret(taskId);

  if (webhookSecret === null) {
    return err({ code: 'unknown_task', message: `Task not found or has no webhook secret: ${taskId}` });
  }

  // Compute expected signature
  const rawBody = JSON.stringify(request.body);
  const timestampStr = Array.isArray(timestamp) ? timestamp[0] ?? '' : timestamp;
  const message = `${timestampStr}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(message)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
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
