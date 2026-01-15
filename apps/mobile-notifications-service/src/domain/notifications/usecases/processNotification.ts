/**
 * Use case for processing incoming notifications from mobile devices.
 * Verifies signature, checks idempotency, and stores new notifications.
 *
 * Logging: Every decision point is logged for debugging and audit.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  NotificationRepository,
  RepositoryError,
  SignatureConnectionRepository,
} from '../ports/index.js';
import type { NotificationFiltersRepository } from '../../filters/index.js';
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
 * Logger interface for processNotification.
 */
export interface ProcessNotificationLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Process an incoming mobile notification.
 * Always returns 200 OK with status indication (except for invalid signature which is handled in route).
 */
export async function processNotification(
  input: ProcessNotificationInput,
  signatureRepo: SignatureConnectionRepository,
  notificationRepo: NotificationRepository,
  logger: ProcessNotificationLogger,
  filtersRepo?: NotificationFiltersRepository
): Promise<Result<ProcessNotificationOutput, RepositoryError>> {
  // Hash the incoming signature
  const signatureHash = hashSignature(input.signature);
  logger.info({ signatureHashPrefix: signatureHash.slice(0, 8) }, 'Signature hashed for lookup');

  // Look up user by signature hash
  logger.info({}, 'Looking up user by signature hash');
  const connectionResult = await signatureRepo.findBySignatureHash(signatureHash);
  if (!connectionResult.ok) {
    logger.error(
      { errorCode: connectionResult.error.code, errorMessage: connectionResult.error.message },
      'Failed to look up signature connection'
    );
    return err(connectionResult.error);
  }

  // If no connection found, ignore
  if (connectionResult.value === null) {
    logger.warn(
      { signatureHashPrefix: signatureHash.slice(0, 8) },
      'No user found for signature hash - invalid signature'
    );
    return ok({ status: 'ignored', reason: 'invalid_signature' });
  }

  const userId = connectionResult.value.userId;
  const connectionId = connectionResult.value.id;
  logger.info({ userId, connectionId }, 'User found for signature');

  // Check for idempotency (notification_id per user)
  logger.info(
    { notificationId: input.payload.notification_id, userId },
    'Checking for duplicate notification'
  );
  const existsResult = await notificationRepo.existsByNotificationIdAndUserId(
    input.payload.notification_id,
    userId
  );
  if (!existsResult.ok) {
    logger.error(
      { errorCode: existsResult.error.code, errorMessage: existsResult.error.message },
      'Failed to check for duplicate notification'
    );
    return err(existsResult.error);
  }

  // If already exists, ignore (idempotent)
  if (existsResult.value) {
    logger.info(
      { notificationId: input.payload.notification_id, userId },
      'Duplicate notification ignored'
    );
    return ok({ status: 'ignored', reason: 'duplicate' });
  }

  // Save the notification
  logger.info(
    {
      userId,
      app: input.payload.app,
      notificationId: input.payload.notification_id,
    },
    'Saving new notification'
  );
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
    logger.error(
      { errorCode: saveResult.error.code, errorMessage: saveResult.error.message },
      'Failed to save notification'
    );
    return err(saveResult.error);
  }

  logger.info(
    { id: saveResult.value.id, userId, app: input.payload.app },
    'Notification saved successfully'
  );

  // Populate filter options (best-effort, don't fail if this fails)
  if (filtersRepo !== undefined) {
    try {
      await filtersRepo.addOptions(userId, {
        app: input.payload.app,
        device: input.payload.device,
        source: input.payload.source,
      });
      logger.info({ userId }, 'Filter options updated');
    } catch {
      logger.warn({ userId }, 'Failed to update filter options (non-critical)');
    }
  }

  return ok({ status: 'accepted', id: saveResult.value.id });
}
