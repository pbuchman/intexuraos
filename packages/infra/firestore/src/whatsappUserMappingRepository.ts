/**
 * Firestore implementation of WhatsAppUserMappingRepository.
 * Stores per-user WhatsApp phone number mappings with inbox configuration.
 */
import { ok, err, type Result, getErrorMessage } from '@praxos/common';
import type {
  WhatsAppUserMappingRepository,
  WhatsAppUserMappingPublic,
  InboxError,
} from '@praxos/domain-inbox';
import { getFirestore } from './client.js';

const COLLECTION_NAME = 'whatsapp_user_mappings';

/**
 * Document structure in Firestore.
 */
interface WhatsAppUserMappingDoc {
  userId: string;
  phoneNumbers: string[];
  inboxNotesDbId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore-backed WhatsApp user mapping repository.
 */
export class FirestoreWhatsAppUserMappingRepository implements WhatsAppUserMappingRepository {
  async saveMapping(
    userId: string,
    phoneNumbers: string[],
    inboxNotesDbId: string
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    try {
      const db = getFirestore();

      // Check for conflicts: ensure no phone number is already mapped to a different user
      const conflictCheck = await this.checkPhoneNumberConflicts(phoneNumbers, userId);
      if (!conflictCheck.ok) {
        return conflictCheck;
      }

      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const now = new Date().toISOString();

      // Get existing doc to preserve createdAt
      const existing = await docRef.get();
      const existingData = existing.data() as WhatsAppUserMappingDoc | undefined;

      const doc: WhatsAppUserMappingDoc = {
        userId,
        phoneNumbers,
        inboxNotesDbId,
        connected: true,
        createdAt: existingData?.createdAt ?? now,
        updatedAt: now,
      };

      await docRef.set(doc);

      return ok({
        phoneNumbers: doc.phoneNumbers,
        inboxNotesDbId: doc.inboxNotesDbId,
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

  async getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as WhatsAppUserMappingDoc;
      return ok({
        phoneNumbers: data.phoneNumbers,
        inboxNotesDbId: data.inboxNotesDbId,
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

  async findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>> {
    try {
      const db = getFirestore();
      const querySnapshot = await db
        .collection(COLLECTION_NAME)
        .where('phoneNumbers', 'array-contains', phoneNumber)
        .where('connected', '==', true)
        .limit(1)
        .get();

      if (querySnapshot.empty) {
        return ok(null);
      }

      const doc = querySnapshot.docs[0];
      if (!doc) {
        return ok(null);
      }
      const data = doc.data() as WhatsAppUserMappingDoc;
      return ok(data.userId);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to find user by phone number: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const now = new Date().toISOString();

      const doc = await docRef.get();
      if (!doc.exists) {
        return err({
          code: 'NOT_FOUND',
          message: 'Mapping not found',
        });
      }

      const existingData = doc.data() as WhatsAppUserMappingDoc;

      const updatedDoc: Partial<WhatsAppUserMappingDoc> = {
        connected: false,
        updatedAt: now,
      };

      await docRef.update(updatedDoc);

      return ok({
        phoneNumbers: existingData.phoneNumbers,
        inboxNotesDbId: existingData.inboxNotesDbId,
        connected: false,
        createdAt: existingData.createdAt,
        updatedAt: now,
      });
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to disconnect mapping: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async isConnected(userId: string): Promise<Result<boolean, InboxError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(false);
      }

      const data = doc.data() as WhatsAppUserMappingDoc;
      return ok(data.connected);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to check connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  /**
   * Check if any of the phone numbers are already mapped to a different user.
   */
  private async checkPhoneNumberConflicts(
    phoneNumbers: string[],
    currentUserId: string
  ): Promise<Result<void, InboxError>> {
    try {
      const db = getFirestore();

      for (const phoneNumber of phoneNumbers) {
        const querySnapshot = await db
          .collection(COLLECTION_NAME)
          .where('phoneNumbers', 'array-contains', phoneNumber)
          .where('connected', '==', true)
          .get();

        for (const doc of querySnapshot.docs) {
          const data = doc.data() as WhatsAppUserMappingDoc;
          if (data.userId !== currentUserId) {
            return err({
              code: 'VALIDATION_ERROR',
              message: `Phone number ${phoneNumber} is already mapped to another user`,
              details: { phoneNumber, conflictingUserId: data.userId },
            });
          }
        }
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to check phone number conflicts: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
