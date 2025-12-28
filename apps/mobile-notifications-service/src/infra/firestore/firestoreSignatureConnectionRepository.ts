/**
 * Firestore implementation of SignatureConnectionRepository.
 * Stores user-signature bindings with hashed signatures.
 */
import { ok, err, type Result, getErrorMessage, getFirestore } from '@intexuraos/common';
import type {
  SignatureConnectionRepository,
  SignatureConnection,
  CreateSignatureConnectionInput,
  RepositoryError,
} from '../../domain/notifications/index.js';

const COLLECTION_NAME = 'mobile_notification_signatures';

/**
 * Document structure in Firestore.
 */
interface SignatureConnectionDoc {
  userId: string;
  signatureHash: string;
  deviceLabel?: string;
  createdAt: string;
}

/**
 * Firestore-backed signature connection repository.
 */
export class FirestoreSignatureConnectionRepository implements SignatureConnectionRepository {
  async save(
    input: CreateSignatureConnectionInput
  ): Promise<Result<SignatureConnection, RepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc();
      const now = new Date().toISOString();

      const doc: SignatureConnectionDoc = {
        userId: input.userId,
        signatureHash: input.signatureHash,
        createdAt: now,
      };

      // Only add deviceLabel if defined
      if (input.deviceLabel !== undefined) {
        doc.deviceLabel = input.deviceLabel;
      }

      await docRef.set(doc);

      const connection: SignatureConnection = {
        id: docRef.id,
        ...doc,
      };

      return ok(connection);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to save signature connection'),
      });
    }
  }

  async findBySignatureHash(
    hash: string
  ): Promise<Result<SignatureConnection | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('signatureHash', '==', hash)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return ok(null);
      }

      const docSnap = snapshot.docs[0];
      if (docSnap === undefined) {
        return ok(null);
      }

      const data = docSnap.data() as SignatureConnectionDoc;
      const connection: SignatureConnection = {
        id: docSnap.id,
        userId: data.userId,
        signatureHash: data.signatureHash,
        createdAt: data.createdAt,
      };

      if (data.deviceLabel !== undefined) {
        connection.deviceLabel = data.deviceLabel;
      }

      return ok(connection);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to find signature connection'),
      });
    }
  }

  async findByUserId(userId: string): Promise<Result<SignatureConnection[], RepositoryError>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION_NAME).where('userId', '==', userId).get();

      const connections: SignatureConnection[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as SignatureConnectionDoc;
        const connection: SignatureConnection = {
          id: docSnap.id,
          userId: data.userId,
          signatureHash: data.signatureHash,
          createdAt: data.createdAt,
        };

        if (data.deviceLabel !== undefined) {
          connection.deviceLabel = data.deviceLabel;
        }

        return connection;
      });

      return ok(connections);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to find signature connections'),
      });
    }
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION_NAME).doc(id).delete();
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to delete signature connection'),
      });
    }
  }

  async deleteByUserId(userId: string): Promise<Result<number, RepositoryError>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION_NAME).where('userId', '==', userId).get();

      if (snapshot.empty) {
        return ok(0);
      }

      const batch = db.batch();
      snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();
      return ok(snapshot.docs.length);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to delete signature connections for user'),
      });
    }
  }

  async existsByUserId(userId: string): Promise<Result<boolean, RepositoryError>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('userId', '==', userId)
        .limit(1)
        .get();

      return ok(!snapshot.empty);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to check if user has signature connections'),
      });
    }
  }
}
