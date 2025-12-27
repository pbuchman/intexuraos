/**
 * Use case for processing incoming notifications from mobile devices.
 * Verifies signature, checks idempotency, and stores new notifications.
 */
import { ok, err, type Result } from '@intexuraos/common';
import type {
  SignatureConnectionRepository,
  NotificationRepository,
  RepositoryError,
} from '../ports/index.js';
import { hashSignature } from './createConnection.js';

/**
 * Webhook payload from mobile device.
 */
export interface WebhookPayload {
  source: string;
  device: string;
  timestamp: number;
  notification_id: string;
  post_time: string;
  app: string;
  title: string;
  text: string;
}

/**
 * Input for processing a notification.
 */
export interface ProcessNotificationInput {
  signature: string; // from header
  payload: WebhookPayload;
}

/**
 * Output from processing a notification.
 */
export interface ProcessNotificationOutput {
  status: 'accepted' | 'ignored';
  id?: string; // only if accepted
  reason?: string; // only if ignored
}

/**
 * Process an incoming mobile notification.
 * Always returns 200 OK with status indication.
 */
export async function processNotification(
  input: ProcessNotificationInput,
  signatureRepo: SignatureConnectionRepository,
  notificationRepo: NotificationRepository
): Promise<Result<ProcessNotificationOutput, RepositoryError>> {
  // Hash the incoming signature
  const signatureHash = hashSignature(input.signature);

  // Look up user by signature hash
  const connectionResult = await signatureRepo.findBySignatureHash(signatureHash);
  if (!connectionResult.ok) {
    return err(connectionResult.error);
  }

  // If no connection found, ignore
  if (connectionResult.value === null) {
    return ok({ status: 'ignored', reason: 'invalid_signature' });
  }

  const userId = connectionResult.value.userId;

  // Check for idempotency (notification_id per user)
  const existsResult = await notificationRepo.existsByNotificationIdAndUserId(
    input.payload.notification_id,
    userId
  );
  if (!existsResult.ok) {
    return err(existsResult.error);
  }

  // If already exists, ignore (idempotent)
  if (existsResult.value) {
    return ok({ status: 'ignored', reason: 'duplicate' });
  }

  // Save the notification
  const saveResult = await notificationRepo.save({
    userId,
    source: input.payload.source,
    device: input.payload.device,
    app: input.payload.app,
    title: input.payload.title,
    text: input.payload.text,
    timestamp: input.payload.timestamp,
    postTime: input.payload.post_time,
    notificationId: input.payload.notification_id,
  });

  if (!saveResult.ok) {
    return err(saveResult.error);
  }

  return ok({ status: 'accepted', id: saveResult.value.id });
}
