/**
 * Firestore implementation of AuthTokenRepository.
 * Stores per-user Auth0 tokens with encrypted refresh tokens.
 */

import { ok, err, type Result, getErrorMessage, getFirestore } from '@intexuraos/common';
import type {
  AuthTokenRepository,
  AuthTokens,
  AuthTokensPublic,
  AuthError,
} from '../../domain/identity/index.js';
import { encryptToken, decryptToken } from './encryption.js';

const COLLECTION_NAME = 'auth_tokens';

/**
 * Document structure in Firestore.
 */
interface AuthTokenDoc {
  userId: string;
  refreshToken: string; // encrypted
  expiresAt: string; // ISO timestamp
  scope?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore-backed Auth token repository.
 */
export class FirestoreAuthTokenRepository implements AuthTokenRepository {
  async saveTokens(
    userId: string,
    tokens: AuthTokens
  ): Promise<Result<AuthTokensPublic, AuthError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const now = new Date().toISOString();

      // Get existing doc to preserve createdAt
      const existing = await docRef.get();
      const existingData = existing.data() as AuthTokenDoc | undefined;

      // Encrypt refresh token before storage
      const encryptedRefreshToken = encryptToken(tokens.refreshToken);

      // Calculate expiration timestamp
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

      const doc: AuthTokenDoc = {
        userId,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        createdAt: existingData?.createdAt ?? now,
        updatedAt: now,
      };

      // Only add scope if defined (Firestore doesn't accept undefined values)
      if (tokens.scope !== undefined) {
        doc.scope = tokens.scope;
      }

      await docRef.set(doc);

      return ok({
        userId,
        hasRefreshToken: true,
        expiresAt: doc.expiresAt,
        scope: doc.scope,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to save tokens: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getTokenMetadata(userId: string): Promise<Result<AuthTokensPublic | null, AuthError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as AuthTokenDoc;
      return ok({
        userId: data.userId,
        hasRefreshToken: true,
        expiresAt: data.expiresAt,
        scope: data.scope,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get token metadata: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getRefreshToken(userId: string): Promise<Result<string | null, AuthError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as AuthTokenDoc;

      // Decrypt refresh token
      const decryptedToken = decryptToken(data.refreshToken);
      return ok(decryptedToken);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get refresh token: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async hasRefreshToken(userId: string): Promise<Result<boolean, AuthError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      return ok(doc.exists);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to check refresh token: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async deleteTokens(userId: string): Promise<Result<void, AuthError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      await docRef.delete();

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to delete tokens: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
