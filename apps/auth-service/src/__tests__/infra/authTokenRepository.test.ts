/**
 * Tests for Firestore AuthToken repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreAuthTokenRepository } from '../../infra/firestore/index.js';
import type { AuthTokens } from '../../domain/identity/index.js';

/**
 * Helper to create test AuthTokens with required fields.
 */
function createTestTokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    ...overrides,
  };
}

describe('FirestoreAuthTokenRepository', () => {
  let repo: FirestoreAuthTokenRepository;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repo = new FirestoreAuthTokenRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveTokens', () => {
    it('saves tokens and returns public metadata', async () => {
      const result = await repo.saveTokens(
        'user-123',
        createTestTokens({
          refreshToken: 'my-refresh-token',
          scope: 'openid profile',
        })
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.hasRefreshToken).toBe(true);
        expect(result.value.scope).toBe('openid profile');
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('updates existing tokens preserving createdAt', async () => {
      await repo.saveTokens('user-123', createTestTokens({ refreshToken: 'token-1' }));

      const first = await repo.getTokenMetadata('user-123');
      const firstCreatedAt = first.ok && first.value ? first.value.createdAt : undefined;

      await new Promise((r) => setTimeout(r, 10));

      await repo.saveTokens(
        'user-123',
        createTestTokens({ refreshToken: 'token-2', expiresIn: 7200 })
      );

      const second = await repo.getTokenMetadata('user-123');

      expect(second.ok).toBe(true);
      if (second.ok && second.value) {
        expect(second.value.createdAt).toBe(firstCreatedAt);
        expect(second.value.updatedAt).not.toBe(firstCreatedAt);
      }
    });

    it('handles tokens without scope', async () => {
      const result = await repo.saveTokens('user-123', createTestTokens());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.scope).toBeUndefined();
      }
    });

    it('encrypts refresh token before storage', async () => {
      await repo.saveTokens('user-123', createTestTokens({ refreshToken: 'my-secret-token' }));

      const stored = fakeFirestore.getAllData().get('auth_tokens')?.get('user-123');
      expect(stored).toBeDefined();
      expect(stored?.['refreshToken']).not.toBe('my-secret-token');
      expect(stored?.['refreshToken']).toContain(':');
    });
  });

  describe('getTokenMetadata', () => {
    it('returns null for non-existent user', async () => {
      const result = await repo.getTokenMetadata('unknown-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns metadata for existing user', async () => {
      await repo.saveTokens('user-123', createTestTokens({ scope: 'openid' }));

      const result = await repo.getTokenMetadata('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.hasRefreshToken).toBe(true);
        expect(result.value.scope).toBe('openid');
      }
    });
  });

  describe('getRefreshToken', () => {
    it('returns null for non-existent user', async () => {
      const result = await repo.getRefreshToken('unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns decrypted refresh token for existing user', async () => {
      await repo.saveTokens(
        'user-123',
        createTestTokens({ refreshToken: 'my-secret-refresh-token' })
      );

      const result = await repo.getRefreshToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('my-secret-refresh-token');
      }
    });
  });

  describe('hasRefreshToken', () => {
    it('returns false for non-existent user', async () => {
      const result = await repo.hasRefreshToken('unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true for existing user', async () => {
      await repo.saveTokens('user-123', createTestTokens());

      const result = await repo.hasRefreshToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });
  });

  describe('deleteTokens', () => {
    it('deletes existing tokens', async () => {
      await repo.saveTokens('user-123', createTestTokens());

      const deleteResult = await repo.deleteTokens('user-123');
      expect(deleteResult.ok).toBe(true);

      const hasToken = await repo.hasRefreshToken('user-123');
      expect(hasToken.ok && hasToken.value).toBe(false);
    });

    it('succeeds even for non-existent user', async () => {
      const result = await repo.deleteTokens('unknown');

      expect(result.ok).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns error when saveTokens fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection failed') });

      const result = await repo.saveTokens('user-123', createTestTokens());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Connection failed');
      }
    });

    it('returns error when getTokenMetadata fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repo.getTokenMetadata('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });

    it('returns error when getRefreshToken fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repo.getRefreshToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });

    it('returns error when hasRefreshToken fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repo.hasRefreshToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });

    it('returns error when deleteTokens fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repo.deleteTokens('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Delete failed');
      }
    });
  });
});
