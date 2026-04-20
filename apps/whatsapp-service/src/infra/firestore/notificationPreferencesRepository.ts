/**
 * Firestore repository for per-user WhatsApp notification preferences.
 *
 * Shares the `whatsapp_user_mappings/{userId}` doc with userMappingRepository
 * but is the sole owner of the `notificationLevel` field. Callers of
 * userMappingRepository must NEVER surface `notificationLevel` to the public
 * WhatsAppUserMappingPublic projection — this repository is the only path.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { WhatsAppError } from '../../domain/whatsapp/index.js';
import {
  DEFAULT_NOTIFICATION_LEVEL,
  isNotificationLevel,
  type NotificationLevel,
  type NotificationPreferences,
} from '../../domain/whatsapp/index.js';

const COLLECTION_NAME = 'whatsapp_user_mappings';

interface WhatsAppUserMappingRawDoc {
  userId?: string;
  phoneNumbers?: string[];
  connected?: boolean;
  createdAt?: string;
  updatedAt?: string;
  notificationLevel?: unknown;
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

    const data = doc.data() as WhatsAppUserMappingRawDoc | undefined;
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

    if (existing.exists) {
      await docRef.update({ notificationLevel: level, updatedAt: now });
    } else {
      await docRef.set({
        userId,
        phoneNumbers: [],
        connected: false,
        createdAt: now,
        updatedAt: now,
        notificationLevel: level,
      });
    }

    return ok({ notificationLevel: level });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to save notification preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
