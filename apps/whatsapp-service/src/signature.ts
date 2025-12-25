/**
 * Webhook signature validation for WhatsApp Business Cloud API.
 *
 * Meta signs webhook payloads using HMAC-SHA256 with the App Secret.
 * The signature is sent in the X-Hub-Signature-256 header.
 *
 * From official docs (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/create-endpoint):
 *
 * > Request syntax:
 * > POST <CALLBACK_URL>
 * > X-Hub-Signature-256: sha256=<SHA256_PAYLOAD_HASH>
 * >
 * > <SHA256_PAYLOAD_HASH>: HMAC-SHA256 hash, calculated using the post body payload
 * > and your app secret as the secret key.
 *
 * Validation steps:
 * 1. Generate HMAC-SHA256 hash using JSON payload as message and App Secret as key
 * 2. Compare generated hash to hash in X-Hub-Signature-256 header (after "sha256=")
 * 3. Use timing-safe comparison to prevent timing attacks
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Header name for webhook signature.
 */
export const SIGNATURE_HEADER = 'x-hub-signature-256';

/**
 * Validate webhook signature against payload.
 *
 * @param payload - Raw request body as string
 * @param signature - Value from X-Hub-Signature-256 header
 * @param appSecret - WhatsApp app secret for HMAC computation
 * @returns true if signature is valid, false otherwise
 */
export function validateWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  // Signature format: sha256=<hex-digest>
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const receivedHash = signature.slice('sha256='.length);

  // Compute expected signature
  const expectedHash = createHmac('sha256', appSecret).update(payload).digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const receivedBuffer = Buffer.from(receivedHash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    // Buffers must be same length for timingSafeEqual
    if (receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    // Invalid hex in signature
    return false;
  }
}
