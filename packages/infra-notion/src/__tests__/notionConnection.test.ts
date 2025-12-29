/**
 * Tests for Notion connection repository.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
} from '../notionConnection.js';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';

describe('Notion Connection Repository', () => {
  let fakeDb: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeDb = createFakeFirestore();
    setFirestore(fakeDb as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveNotionConnection', () => {
    it('creates a new connection', async () => {
      const result = await saveNotionConnection('user-123', 'page-abc', 'secret-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptVaultPageId).toBe('page-abc');
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('preserves createdAt on update', async () => {
      // Create initial connection
      const first = await saveNotionConnection('user-123', 'page-1', 'token-1');
      expect(first.ok).toBe(true);
      const originalCreatedAt = first.ok ? first.value.createdAt : '';

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update connection
      const second = await saveNotionConnection('user-123', 'page-2', 'token-2');
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.createdAt).toBe(originalCreatedAt);
        expect(second.value.promptVaultPageId).toBe('page-2');
      }
    });

    it('returns error on Firestore failure', async () => {
      fakeDb.configure({ errorToThrow: new Error('Firestore unavailable') });

      const result = await saveNotionConnection('user-123', 'page-abc', 'token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to save connection');
      }
    });
  });

  describe('getNotionConnection', () => {
    it('returns null for non-existent user', async () => {
      const result = await getNotionConnection('non-existent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns public connection data without token', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'secret-token');

      const result = await getNotionConnection('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.promptVaultPageId).toBe('page-abc');
        expect(result.value?.connected).toBe(true);
        // Should NOT contain token
        expect((result.value as unknown as { notionToken?: string }).notionToken).toBeUndefined();
      }
    });

    it('returns error on Firestore failure', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');
      fakeDb.configure({ errorToThrow: new Error('Firestore down') });

      const result = await getNotionConnection('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to get connection');
      }
    });
  });

  describe('getNotionToken', () => {
    it('returns null for non-existent user', async () => {
      const result = await getNotionToken('non-existent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns token for connected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'secret-token-123');

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('secret-token-123');
      }
    });

    it('returns null for disconnected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');
      await disconnectNotion('user-123');

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error on Firestore failure', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');
      fakeDb.configure({ errorToThrow: new Error('Firestore error') });

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to get token');
      }
    });
  });

  describe('isNotionConnected', () => {
    it('returns false for non-existent user', async () => {
      const result = await isNotionConnected('non-existent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true for connected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for disconnected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');
      await disconnectNotion('user-123');

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns error on Firestore failure', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');
      fakeDb.configure({ errorToThrow: new Error('Connection failed') });

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to check connection');
      }
    });
  });

  describe('disconnectNotion', () => {
    it('disconnects connected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
        expect(result.value.promptVaultPageId).toBe('page-abc');
      }

      // Verify disconnection
      const connectionResult = await isNotionConnected('user-123');
      expect(connectionResult.ok && connectionResult.value).toBe(false);
    });

    it('returns connection info after disconnect', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('returns error on Firestore failure', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token');
      fakeDb.configure({ errorToThrow: new Error('Update failed') });

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to disconnect');
      }
    });

    it('handles disconnect of non-existent user', async () => {
      // This will throw because update() throws for non-existent documents
      const result = await disconnectNotion('non-existent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
