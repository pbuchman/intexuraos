/**
 * Tests for FirestoreAuthTokenRepository.
 *
 * Uses real Firestore implementation against emulator.
 */
import { describe, it, expect } from 'vitest';
import { isOk } from '@praxos/common';
import type { AuthTokens } from '@praxos/domain-identity';
import { FirestoreAuthTokenRepository } from '../authTokenRepository.js';

describe('FirestoreAuthTokenRepository', () => {
  function createRepo(): FirestoreAuthTokenRepository {
    return new FirestoreAuthTokenRepository();
  }

  const userId = 'auth0|123456';
  const tokens: AuthTokens = {
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    tokenType: 'Bearer',
    expiresIn: 3600,
    scope: 'openid profile offline_access',
    idToken: 'id-token-value',
  };

  describe('saveTokens', () => {
    it('should save tokens successfully for new user', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.saveTokens(userId, tokens);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toMatchObject({
          userId,
          hasRefreshToken: true,
          scope: tokens.scope,
        });
        expect(result.value.expiresAt).toBeDefined();
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('should preserve createdAt for existing user', async (): Promise<void> => {
      const repo = createRepo();

      // Save initial tokens
      const firstResult = await repo.saveTokens(userId, tokens);
      expect(isOk(firstResult)).toBe(true);
      const existingCreatedAt = isOk(firstResult) ? firstResult.value.createdAt : '';

      // Update tokens
      const newTokens: AuthTokens = {
        ...tokens,
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };
      const result = await repo.saveTokens(userId, newTokens);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.createdAt).toBe(existingCreatedAt);
        expect(result.value.updatedAt).not.toBe(existingCreatedAt);
      }
    });

    it('should handle missing scope', async (): Promise<void> => {
      const repo = createRepo();

      const tokensWithoutScope: AuthTokens = {
        ...tokens,
        scope: undefined,
      };

      const result = await repo.saveTokens('user-without-scope', tokensWithoutScope);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.scope).toBeUndefined();
      }
    });
  });

  describe('getTokenMetadata', () => {
    it('should return metadata for existing user', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveTokens(userId, tokens);

      const result = await repo.getTokenMetadata(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result) && result.value) {
        expect(result.value.userId).toBe(userId);
        expect(result.value.hasRefreshToken).toBe(true);
        expect(result.value.scope).toBe(tokens.scope);
      }
    });

    it('should return null for non-existent user', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.getTokenMetadata('non-existent-user');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('getRefreshToken', () => {
    it('should return decrypted refresh token', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveTokens(userId, tokens);

      const result = await repo.getRefreshToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(tokens.refreshToken);
      }
    });

    it('should return null for non-existent user', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.getRefreshToken('non-existent-user');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('hasRefreshToken', () => {
    it('should return true when refresh token exists', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveTokens(userId, tokens);

      const result = await repo.hasRefreshToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false when user does not exist', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.hasRefreshToken('non-existent-user');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('deleteTokens', () => {
    it('should delete tokens successfully', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveTokens(userId, tokens);

      const result = await repo.deleteTokens(userId);

      expect(isOk(result)).toBe(true);

      // Verify deleted
      const getResult = await repo.getTokenMetadata(userId);
      expect(isOk(getResult)).toBe(true);
      if (isOk(getResult)) {
        expect(getResult.value).toBeNull();
      }
    });

    it('should succeed even if user does not exist', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.deleteTokens('non-existent-user');

      expect(isOk(result)).toBe(true);
    });
  });
});
