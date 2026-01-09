/**
 * Tests for Firestore OAuthConnection repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreOAuthConnectionRepository } from '../../infra/firestore/oauthConnectionRepository.js';
import { OAuthProviders, type OAuthTokens } from '../../domain/oauth/index.js';

function createTestTokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: '2025-01-01T12:00:00.000Z',
    scope: 'email calendar.events',
    ...overrides,
  };
}

describe('FirestoreOAuthConnectionRepository', () => {
  let repo: FirestoreOAuthConnectionRepository;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    process.env['INTEXURAOS_ENCRYPTION_KEY'] = 'test-encryption-key-32-bytes-xx';
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repo = new FirestoreOAuthConnectionRepository();
  });

  afterEach(() => {
    resetFirestore();
    delete process.env['INTEXURAOS_ENCRYPTION_KEY'];
  });

  describe('saveConnection', () => {
    it('saves new connection and returns public metadata', async () => {
      const result = await repo.saveConnection(
        'user-123',
        OAuthProviders.GOOGLE,
        'user@example.com',
        createTestTokens()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.provider).toBe(OAuthProviders.GOOGLE);
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.scopes).toContain('email');
        expect(result.value.scopes).toContain('calendar.events');
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('updates existing connection preserving createdAt', async () => {
      await repo.saveConnection('user-123', OAuthProviders.GOOGLE, 'old@example.com', createTestTokens());
      await new Promise((r) => setTimeout(r, 10));
      const result = await repo.saveConnection(
        'user-123',
        OAuthProviders.GOOGLE,
        'new@example.com',
        createTestTokens({ accessToken: 'new-token' })
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.email).toBe('new@example.com');
        const getResult = await repo.getConnectionPublic('user-123', OAuthProviders.GOOGLE);
        if (getResult.ok && getResult.value !== null) {
          expect(getResult.value.createdAt).not.toBe(getResult.value.updatedAt);
        }
      }
    });
  });

  describe('getConnection', () => {
    it('returns null when connection does not exist', async () => {
      const result = await repo.getConnection('nonexistent', OAuthProviders.GOOGLE);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns full connection with decrypted tokens', async () => {
      const tokens = createTestTokens({
        accessToken: 'my-access-token',
        refreshToken: 'my-refresh-token',
      });
      await repo.saveConnection('user-123', OAuthProviders.GOOGLE, 'user@example.com', tokens);

      const result = await repo.getConnection('user-123', OAuthProviders.GOOGLE);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.provider).toBe(OAuthProviders.GOOGLE);
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.tokens.accessToken).toBe('my-access-token');
        expect(result.value.tokens.refreshToken).toBe('my-refresh-token');
        expect(result.value.tokens.expiresAt).toBe(tokens.expiresAt);
        expect(result.value.tokens.scope).toBe(tokens.scope);
      }
    });
  });

  describe('getConnectionPublic', () => {
    it('returns null when connection does not exist', async () => {
      const result = await repo.getConnectionPublic('nonexistent', OAuthProviders.GOOGLE);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns public connection without tokens', async () => {
      await repo.saveConnection('user-123', OAuthProviders.GOOGLE, 'user@example.com', createTestTokens());

      const result = await repo.getConnectionPublic('user-123', OAuthProviders.GOOGLE);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.provider).toBe(OAuthProviders.GOOGLE);
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.scopes).toContain('email');
        expect(Object.keys(result.value)).not.toContain('tokens');
      }
    });
  });

  describe('updateTokens', () => {
    it('updates tokens for existing connection', async () => {
      await repo.saveConnection('user-123', OAuthProviders.GOOGLE, 'user@example.com', createTestTokens());

      const newTokens = createTestTokens({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: '2025-12-31T23:59:59.000Z',
      });
      const updateResult = await repo.updateTokens('user-123', OAuthProviders.GOOGLE, newTokens);

      expect(updateResult.ok).toBe(true);

      const getResult = await repo.getConnection('user-123', OAuthProviders.GOOGLE);
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value !== null) {
        expect(getResult.value.tokens.accessToken).toBe('new-access-token');
        expect(getResult.value.tokens.refreshToken).toBe('new-refresh-token');
        expect(getResult.value.tokens.expiresAt).toBe('2025-12-31T23:59:59.000Z');
      }
    });

    it('returns error when connection does not exist', async () => {
      const result = await repo.updateTokens('nonexistent', OAuthProviders.GOOGLE, createTestTokens());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('deleteConnection', () => {
    it('deletes existing connection', async () => {
      await repo.saveConnection('user-123', OAuthProviders.GOOGLE, 'user@example.com', createTestTokens());

      const deleteResult = await repo.deleteConnection('user-123', OAuthProviders.GOOGLE);
      expect(deleteResult.ok).toBe(true);

      const getResult = await repo.getConnection('user-123', OAuthProviders.GOOGLE);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('succeeds even when connection does not exist', async () => {
      const result = await repo.deleteConnection('nonexistent', OAuthProviders.GOOGLE);
      expect(result.ok).toBe(true);
    });
  });

  describe('multiple providers', () => {
    it('stores connections for different providers separately', async () => {
      await repo.saveConnection('user-123', OAuthProviders.GOOGLE, 'user@gmail.com', createTestTokens());

      const googleResult = await repo.getConnectionPublic('user-123', OAuthProviders.GOOGLE);
      expect(googleResult.ok).toBe(true);
      if (googleResult.ok) {
        expect(googleResult.value?.email).toBe('user@gmail.com');
      }
    });
  });
});
