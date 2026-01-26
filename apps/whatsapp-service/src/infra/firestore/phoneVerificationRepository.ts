/**
 * Firestore repository for phone number verification.
 *
 * NOTE: This file is tested via FakePhoneVerificationRepository in route tests.
 * The real Firestore implementation is not directly tested.
 */
/* v8 ignore start - Tested via fake repository in route integration tests */
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

/**
 * Atomically create a verification record with all constraint checks.
 * Uses a Firestore transaction to prevent race conditions.
 */
export async function createVerificationWithChecks(
  params: {
    userId: string;
    phoneNumber: string;
    code: string;
    expiresAt: number;
    cooldownSeconds: number;
    maxRequestsPerHour: number;
    windowStartTime: string;
  }
): Promise<Result<{
  verification: PhoneVerification;
  cooldownUntil: number;
  existingPendingId?: string;
}, WhatsAppError>> {
  try {
    const db = getFirestore();
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);

    type TransactionResult = Result<{
      verification: PhoneVerification;
      cooldownUntil: number;
    }, WhatsAppError>;

    const result = await db.runTransaction(async (transaction): Promise<TransactionResult> => {
      const collection = db.collection(COLLECTION_NAME);

      // Check 1: Phone already verified for user
      const verifiedQuery = collection
        .where('userId', '==', params.userId)
        .where('phoneNumber', '==', params.phoneNumber)
        .where('status', '==', 'verified')
        .limit(1);
      const verifiedSnapshot = await transaction.get(verifiedQuery);

      if (!verifiedSnapshot.empty) {
        return err({
          code: 'ALREADY_VERIFIED',
          message: 'Phone number already verified',
        });
      }

      // Check 2: Pending verification within cooldown window
      const pendingQuery = collection
        .where('userId', '==', params.userId)
        .where('phoneNumber', '==', params.phoneNumber)
        .where('status', '==', 'pending')
        .where('expiresAt', '>', nowSeconds)
        .orderBy('expiresAt', 'desc')
        .limit(1);
      const pendingSnapshot = await transaction.get(pendingQuery);

      if (!pendingSnapshot.empty) {
        const pendingDoc = pendingSnapshot.docs[0];
        if (pendingDoc === undefined) {
          return err({ code: 'PERSISTENCE_ERROR', message: 'Unexpected undefined doc' });
        }
        const pending = pendingDoc.data() as PhoneVerification;
        const createdAtTime = new Date(pending.createdAt).getTime();
        const cooldownEnd = createdAtTime + params.cooldownSeconds * 1000;

        if (Date.now() < cooldownEnd) {
          return err({
            code: 'COOLDOWN_ACTIVE',
            message: 'Please wait before requesting another code',
            details: {
              cooldownUntil: Math.floor(cooldownEnd / 1000),
              existingPendingId: pending.id,
            },
          });
        }
      }

      // Check 3: Rate limit (max requests per hour)
      const rateLimitQuery = collection
        .where('phoneNumber', '==', params.phoneNumber)
        .where('createdAt', '>=', params.windowStartTime);
      const rateLimitSnapshot = await transaction.get(rateLimitQuery);

      if (rateLimitSnapshot.size >= params.maxRequestsPerHour) {
        return err({
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many verification requests. Try again later.',
        });
      }

      // All checks passed - create verification record
      const id = randomUUID();
      const verification: PhoneVerification = {
        id,
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        code: params.code,
        attempts: 0,
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: params.expiresAt,
      };

      const docRef = collection.doc(id);
      transaction.set(docRef, verification);

      const cooldownUntil = nowSeconds + params.cooldownSeconds;
      return ok({ verification, cooldownUntil });
    });

    return result;
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to create verification: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
/* v8 ignore stop */
