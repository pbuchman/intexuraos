/**
 * Firestore repository for WhatsApp user phone number mappings.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { InboxError } from './webhookEventRepository.js';
import { normalizePhoneNumber } from '../../domain/whatsapp/index.js';

export interface WhatsAppUserMappingPublic {
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WhatsAppUserMappingDoc extends WhatsAppUserMappingPublic {
  userId: string;
}

const COLLECTION_NAME = 'whatsapp_user_mappings';

export async function saveUserMapping(
  userId: string,
  phoneNumbers: string[]
): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
  try {
    const db = getFirestore();

    // Check for conflicts
    for (const phoneNumber of phoneNumbers) {
      const existing = await db
        .collection(COLLECTION_NAME)
        .where('phoneNumbers', 'array-contains', phoneNumber)
        .where('connected', '==', true)
        .get();

      for (const doc of existing.docs) {
        const data = doc.data() as WhatsAppUserMappingDoc;
        if (data.userId !== userId) {
          return err({
            code: 'VALIDATION_ERROR',
            message: `Phone number ${phoneNumber} is already mapped to another user`,
            details: { phoneNumber },
          });
        }
      }
    }

    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();
    const existingDoc = await docRef.get();
    const existingData = existingDoc.data() as WhatsAppUserMappingDoc | undefined;

    const doc: WhatsAppUserMappingDoc = {
      userId,
      phoneNumbers,
      connected: true,
      createdAt: existingData?.createdAt ?? now,
      updatedAt: now,
    };

    await docRef.set(doc);

    return ok({
      phoneNumbers: doc.phoneNumbers,
      connected: doc.connected,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to save mapping: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function getUserMapping(
  userId: string
): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as WhatsAppUserMappingDoc;
    return ok({
      phoneNumbers: data.phoneNumbers,
      connected: data.connected,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to get mapping: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function findUserByPhoneNumber(
  phoneNumber: string
): Promise<Result<string | null, InboxError>> {
  try {
    const db = getFirestore();
    // Normalize phone number to match stored format (without "+")
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('phoneNumbers', 'array-contains', normalizedPhone)
      .where('connected', '==', true)
      .limit(1)
      .get();

    if (snapshot.empty) return ok(null);
    const doc = snapshot.docs[0];
    if (!doc) return ok(null);
    return ok((doc.data() as WhatsAppUserMappingDoc).userId);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to find user: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function disconnectUserMapping(
  userId: string
): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return err({ code: 'NOT_FOUND', message: 'Mapping not found' });
    }

    const existingData = doc.data() as WhatsAppUserMappingDoc;
    const now = new Date().toISOString();

    await docRef.update({ connected: false, updatedAt: now });

    return ok({
      phoneNumbers: existingData.phoneNumbers,
      connected: false,
      createdAt: existingData.createdAt,
      updatedAt: now,
    });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to disconnect: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function isUserConnected(userId: string): Promise<Result<boolean, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(false);
    return ok((doc.data() as WhatsAppUserMappingDoc).connected);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to check connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function findPhoneByUserId(
  userId: string
): Promise<Result<string | null, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as WhatsAppUserMappingDoc;
    if (!data.connected) return ok(null);

    const firstPhone = data.phoneNumbers[0];
    if (firstPhone === undefined) return ok(null);

    return ok(firstPhone);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to find phone: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
