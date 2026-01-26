/**
 * Firestore repository for phone number verification.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { randomUUID } from 'node:crypto';
import type {
  PhoneVerification,
  PhoneVerificationStatus,
} from '../../domain/whatsapp/models/PhoneVerification.js';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';

const COLLECTION_NAME = 'whatsapp_phone_verifications';

export async function createVerification(
  verification: Omit<PhoneVerification, 'id'>
): Promise<Result<PhoneVerification, WhatsAppError>> {
  try {
    const db = getFirestore();
    const id = randomUUID();
    const doc: PhoneVerification = { id, ...verification };
    await db.collection(COLLECTION_NAME).doc(id).set(doc);
    return ok(doc);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to create verification: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function findVerificationById(
  id: string
): Promise<Result<PhoneVerification | null, WhatsAppError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    if (!doc.exists) return ok(null);
    return ok(doc.data() as PhoneVerification);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to find verification: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function findPendingByUserAndPhone(
  userId: string,
  phoneNumber: string
): Promise<Result<PhoneVerification | null, WhatsAppError>> {
  try {
    const db = getFirestore();
    const now = Math.floor(Date.now() / 1000);

    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('userId', '==', userId)
      .where('phoneNumber', '==', phoneNumber)
      .where('status', '==', 'pending')
      .where('expiresAt', '>', now)
      .orderBy('expiresAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return ok(null);
    const doc = snapshot.docs[0];
    /* v8 ignore next - noUncheckedIndexedAccess guard */
    if (!doc) return ok(null);
    return ok(doc.data() as PhoneVerification);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to find pending verification: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function isPhoneVerified(
  userId: string,
  phoneNumber: string
): Promise<Result<boolean, WhatsAppError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('userId', '==', userId)
      .where('phoneNumber', '==', phoneNumber)
      .where('status', '==', 'verified')
      .limit(1)
      .get();

    return ok(!snapshot.empty);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to check verification status: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function updateVerificationStatus(
  id: string,
  status: PhoneVerificationStatus,
  metadata?: { verifiedAt?: string; lastAttemptAt?: string }
): Promise<Result<PhoneVerification, WhatsAppError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return err({ code: 'NOT_FOUND', message: 'Verification not found' });
    }

    const updateData: Record<string, unknown> = { status };
    if (metadata?.verifiedAt !== undefined) {
      updateData['verifiedAt'] = metadata.verifiedAt;
    }
    if (metadata?.lastAttemptAt !== undefined) {
      updateData['lastAttemptAt'] = metadata.lastAttemptAt;
    }

    await docRef.update(updateData);

    const updated = await docRef.get();
    return ok(updated.data() as PhoneVerification);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update verification status: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function incrementVerificationAttempts(
  id: string
): Promise<Result<PhoneVerification, WhatsAppError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return err({ code: 'NOT_FOUND', message: 'Verification not found' });
    }

    const current = doc.data() as PhoneVerification;
    const newAttempts = current.attempts + 1;
    const lastAttemptAt = new Date().toISOString();

    await docRef.update({
      attempts: newAttempts,
      lastAttemptAt,
    });

    return ok({
      ...current,
      attempts: newAttempts,
      lastAttemptAt,
    });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to increment attempts: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function countRecentVerificationsByPhone(
  phoneNumber: string,
  windowStartTime: string
): Promise<Result<number, WhatsAppError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('phoneNumber', '==', phoneNumber)
      .where('createdAt', '>=', windowStartTime)
      .get();

    return ok(snapshot.size);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to count recent verifications: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
