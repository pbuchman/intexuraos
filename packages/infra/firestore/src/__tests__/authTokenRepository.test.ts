import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isOk, isErr } from '@praxos/common';
import type { AuthTokens } from '@praxos/domain-identity';
import { FirestoreAuthTokenRepository } from '../authTokenRepository.js';
import { setFirestore, resetFirestore } from '../client.js';

// Mock Firestore
const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();
const mockDoc = vi.fn(() => ({
  set: mockSet,
  get: mockGet,
  delete: mockDelete,
}));
const mockCollection = vi.fn(() => ({
  doc: mockDoc,
}));

const mockFirestore = {
  collection: mockCollection,
} as unknown as FirebaseFirestore.Firestore;

describe('FirestoreAuthTokenRepository', () => {
  let repo: FirestoreAuthTokenRepository;

  beforeEach(() => {
    setFirestore(mockFirestore);
    repo = new FirestoreAuthTokenRepository();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveTokens', () => {
    const userId = 'auth0|123456';
    const tokens: AuthTokens = {
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'openid profile offline_access',
      idToken: 'id-token-value',
    };

    it('should save tokens successfully for new user', async () => {
      mockGet.mockResolvedValue({ data: () => undefined });
      mockSet.mockResolvedValue(undefined);

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

      expect(mockSet).toHaveBeenCalledOnce();
      const calls = mockSet.mock.calls;
      if (calls.length > 0 && calls[0] !== undefined) {
        const savedDoc = calls[0][0] as Record<string, unknown>;
        expect(savedDoc['userId']).toBe(userId);
        expect(savedDoc['refreshToken']).not.toBe(tokens.refreshToken); // Should be encrypted
        expect(savedDoc['scope']).toBe(tokens.scope);
      }
    });

    it('should preserve createdAt for existing user', async () => {
      const existingCreatedAt = new Date('2024-01-01T00:00:00Z').toISOString();
      mockGet.mockResolvedValue({
        data: () => ({
          userId,
          refreshToken: 'old-encrypted-token',
          expiresAt: new Date().toISOString(),
          createdAt: existingCreatedAt,
          updatedAt: new Date().toISOString(),
        }),
      });
      mockSet.mockResolvedValue(undefined);

      const result = await repo.saveTokens(userId, tokens);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.createdAt).toBe(existingCreatedAt);
        expect(result.value.updatedAt).not.toBe(existingCreatedAt);
      }
    });

    it('should handle missing scope', async () => {
      const tokensWithoutScope: AuthTokens = {
        ...tokens,
        scope: undefined,
      };
      mockGet.mockResolvedValue({ data: () => undefined });
      mockSet.mockResolvedValue(undefined);

      const result = await repo.saveTokens(userId, tokensWithoutScope);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.scope).toBeUndefined();
      }
    });

    it('should return error on Firestore failure', async () => {
      mockGet.mockRejectedValue(new Error('Firestore connection failed'));

      const result = await repo.saveTokens(userId, tokens);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to save tokens');
        expect(result.error.message).toContain('Firestore connection failed');
      }
    });

    it('should handle non-Error exceptions', async () => {
      mockGet.mockRejectedValue('string error');

      const result = await repo.saveTokens(userId, tokens);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Unknown Firestore error');
      }
    });
  });

  describe('getTokenMetadata', () => {
    const userId = 'auth0|123456';

    it('should return metadata for existing user', async () => {
      const mockData = {
        userId,
        refreshToken: 'encrypted-refresh-token',
        expiresAt: new Date().toISOString(),
        scope: 'openid profile',
        createdAt: new Date('2024-01-01').toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockGet.mockResolvedValue({
        exists: true,
        data: () => mockData,
      });

      const result = await repo.getTokenMetadata(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result) && result.value) {
        expect(result.value.userId).toBe(userId);
        expect(result.value.hasRefreshToken).toBe(true);
        expect(result.value.expiresAt).toBe(mockData.expiresAt);
        expect(result.value.scope).toBe(mockData.scope);
      }
    });

    it('should return null for non-existent user', async () => {
      mockGet.mockResolvedValue({ exists: false });

      const result = await repo.getTokenMetadata(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });

    it('should return error on Firestore failure', async () => {
      mockGet.mockRejectedValue(new Error('Database error'));

      const result = await repo.getTokenMetadata(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to get token metadata');
      }
    });
  });

  describe('getRefreshToken', () => {
    const userId = 'auth0|123456';

    it('should return decrypted refresh token', async () => {
      // Import encryption here to use real encryption/decryption
      const { encryptToken } = await import('../encryption.js');
      const originalToken = 'my-refresh-token-value';
      const encryptedToken = encryptToken(originalToken);

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          userId,
          refreshToken: encryptedToken,
          expiresAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });

      const result = await repo.getRefreshToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(originalToken);
      }
    });

    it('should return null for non-existent user', async () => {
      mockGet.mockResolvedValue({ exists: false });

      const result = await repo.getRefreshToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });

    it('should return error on Firestore failure', async () => {
      mockGet.mockRejectedValue(new Error('Connection lost'));

      const result = await repo.getRefreshToken(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to get refresh token');
      }
    });
  });

  describe('hasRefreshToken', () => {
    const userId = 'auth0|123456';

    it('should return true when refresh token exists', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          userId,
          refreshToken: 'encrypted-token',
          expiresAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });

      const result = await repo.hasRefreshToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false when user does not exist', async () => {
      mockGet.mockResolvedValue({ exists: false });

      const result = await repo.hasRefreshToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(false);
      }
    });

    it('should return error on Firestore failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const result = await repo.hasRefreshToken(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('deleteTokens', () => {
    const userId = 'auth0|123456';

    it('should delete tokens successfully', async () => {
      mockDelete.mockResolvedValue(undefined);

      const result = await repo.deleteTokens(userId);

      expect(isOk(result)).toBe(true);
      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it('should return error on Firestore failure', async () => {
      mockDelete.mockRejectedValue(new Error('Permission denied'));

      const result = await repo.deleteTokens(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to delete tokens');
      }
    });
  });
});
