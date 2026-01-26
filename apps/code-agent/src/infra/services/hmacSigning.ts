/**
 * HMAC signing for task dispatch requests.
 *
 * Provides replay protection through timestamp-based signatures.
 */

import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { SigningError } from '../../domain/models/signing.js';
import * as crypto from 'node:crypto';

/**
 * Dependencies for HMAC signing.
 */
export interface HmacSigningDeps {
  logger: Logger;
  dispatchSigningSecret: string;
}

/**
 * Parameters for signing a dispatch request.
 */
export interface SignDispatchParams {
  body: string;
  timestamp: number;
}

/**
 * Result of signing operation.
 */
export interface SignatureResult {
  timestamp: number;
  signature: string;
}

/**
 * Sign a dispatch request with HMAC.
 *
 * Process per design lines 1588-1602:
 * 1. Create message: `{timestamp}.{body}`
 * 2. Sign with INTEXURAOS_DISPATCH_SECRET using HMAC-SHA256
 *
 * @param params - Body and timestamp to sign
 * @returns Signature result or error
 */
export function signDispatchRequest(
  deps: HmacSigningDeps,
  params: SignDispatchParams
): Result<SignatureResult, SigningError> {
  const { dispatchSigningSecret } = deps;
  if (dispatchSigningSecret === '') {
    return err({
      code: 'missing_secret',
      message: 'dispatchSigningSecret is required',
    });
  }

  try {
    const { body, timestamp } = params;
    const message = `${String(timestamp)}.${body}`;

    const signature = crypto.createHmac('sha256', dispatchSigningSecret).update(message).digest('hex');

    deps.logger.debug(
      { timestamp: String(timestamp), signature: signature.substring(0, 8) + '...' },
      'Generated HMAC signature for dispatch request'
    );

    return ok({ timestamp, signature });
  } catch (error) {
    deps.logger.error({ error }, 'Failed to generate HMAC signature');

    return err({
      code: 'signing_failed',
      message: `Failed to generate HMAC signature: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Generate a unique webhook secret for a task.
 *
 * Format: `whsec_{24 hex chars}` per design specification.
 *
 * @returns Webhook secret string
 */
export function generateWebhookSecret(): string {
  const randomBytes = crypto.randomBytes(24);
  return `whsec_${randomBytes.toString('hex')}`;
}

/**
 * Generate a unique nonce for request replay protection.
 *
 * @returns UUID v4 string
 */
export function generateNonce(): string {
  return crypto.randomUUID();
}
