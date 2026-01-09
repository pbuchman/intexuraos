/**
 * Firestore implementation of OAuthConnectionRepository.
 * Stores OAuth tokens with encryption for access and refresh tokens.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  OAuthConnection,
  OAuthConnectionPublic,
  OAuthProvider,
  OAuthTokens,
} from '../../domain/oauth/index.js';
import type { OAuthConnectionRepository } from '../../domain/oauth/ports/OAuthConnectionRepository.js';
import type { OAuthError } from '../../domain/oauth/models/OAuthError.js';
import { decryptToken, encryptToken } from './encryption.js';

const COLLECTION_NAME = 'oauth_connections';

interface OAuthConnectionDoc {
  userId: string;
  provider: OAuthProvider;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

function getDocId(userId: string, provider: OAuthProvider): string {
  return `${userId}_${provider}`;
}

export class FirestoreOAuthConnectionRepository implements OAuthConnectionRepository {
  async saveConnection(
    userId: string,
    provider: OAuthProvider,
    email: string,
    tokens: OAuthTokens
  ): Promise<Result<OAuthConnectionPublic, OAuthError>> {
    try {
      const db = getFirestore();
      const docId = getDocId(userId, provider);
      const docRef = db.collection(COLLECTION_NAME).doc(docId);
      const now = new Date().toISOString();

      const existing = await docRef.get();
      const existingData = existing.data() as OAuthConnectionDoc | undefined;

      const doc: OAuthConnectionDoc = {
        userId,
        provider,
        email,
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        createdAt: existingData?.createdAt ?? now,
        updatedAt: now,
      };

      await docRef.set(doc);

      return ok({
        userId,
        provider,
        email,
        scopes: tokens.scope.split(' '),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to save OAuth connection: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async getConnection(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthConnection | null, OAuthError>> {
    try {
      const db = getFirestore();
      const docId = getDocId(userId, provider);
      const docRef = db.collection(COLLECTION_NAME).doc(docId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as OAuthConnectionDoc;

      return ok({
        userId: data.userId,
        provider: data.provider,
        email: data.email,
        tokens: {
          accessToken: decryptToken(data.accessToken),
          refreshToken: decryptToken(data.refreshToken),
          expiresAt: data.expiresAt,
          scope: data.scope,
        },
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get OAuth connection: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async getConnectionPublic(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthConnectionPublic | null, OAuthError>> {
    try {
      const db = getFirestore();
      const docId = getDocId(userId, provider);
      const docRef = db.collection(COLLECTION_NAME).doc(docId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as OAuthConnectionDoc;

      return ok({
        userId: data.userId,
        provider: data.provider,
        email: data.email,
        scopes: data.scope.split(' '),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get OAuth connection: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async updateTokens(
    userId: string,
    provider: OAuthProvider,
    tokens: OAuthTokens
  ): Promise<Result<void, OAuthError>> {
    try {
      const db = getFirestore();
      const docId = getDocId(userId, provider);
      const docRef = db.collection(COLLECTION_NAME).doc(docId);

      await docRef.update({
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        updatedAt: new Date().toISOString(),
      });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update OAuth tokens: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  async deleteConnection(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<void, OAuthError>> {
    try {
      const db = getFirestore();
      const docId = getDocId(userId, provider);
      const docRef = db.collection(COLLECTION_NAME).doc(docId);
      await docRef.delete();

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to delete OAuth connection: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }
}
