/**
 * Firestore repository for per-user WhatsApp notification preferences.
 *
 * Owns the `whatsapp_notification_preferences/{userId}` collection exclusively.
 * This repository MUST NEVER read or write `whatsapp_user_mappings`.
 * The structural separation (separate collection) is the enforcement mechanism —
 * notificationLevel is now physically isolated from the user-mapping document.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore, withSchemaVersion } from '@intexuraos/infra-firestore';
import type { WhatsAppError } from '../../domain/whatsapp/index.js';
import {
  DEFAULT_NOTIFICATION_LEVEL,
  isNotificationLevel,
  type NotificationLevel,
  type NotificationPreferences,
} from '../../domain/whatsapp/index.js';

const COLLECTION_NAME = 'whatsapp_notification_preferences';

interface WhatsAppNotificationPreferencesDoc {
  userId?: string;
  notificationLevel?: unknown;
  schemaVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function getPreferences(
  userId: string
): Promise<Result<NotificationPreferences, WhatsAppError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) {
      return ok({ notificationLevel: DEFAULT_NOTIFICATION_LEVEL });
    }

    const data = doc.data() as WhatsAppNotificationPreferencesDoc | undefined;
    const raw = data?.notificationLevel;
    const level: NotificationLevel = isNotificationLevel(raw) ? raw : DEFAULT_NOTIFICATION_LEVEL;
    return ok({ notificationLevel: level });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to get notification preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function savePreferences(
  userId: string,
  level: NotificationLevel
): Promise<Result<NotificationPreferences, WhatsAppError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    const existing = await docRef.get();
    const existingData = existing.exists
      ? (existing.data() as WhatsAppNotificationPreferencesDoc | undefined)
      : undefined;
    const createdAt = existingData?.createdAt ?? now;

    const body = withSchemaVersion(
      {
        userId,
        notificationLevel: level,
        createdAt,
        updatedAt: now,
      },
      1
    );

    await docRef.set(body, { merge: true });

    return ok({ notificationLevel: level });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to save notification preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
