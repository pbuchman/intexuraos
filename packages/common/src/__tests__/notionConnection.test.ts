/**
 * Tests for notionConnection repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
} from '../notionConnection.js';
import { createFakeFirestore, type FakeFirestore } from '../testing/index.js';
import { setFirestore } from '../firestore.js';

describe('notionConnection', () => {
  let fakeFirestore: FakeFirestore;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as FirebaseFirestore.Firestore);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('saveNotionConnection', () => {
    it('saves new connection successfully', async () => {
      const result = await saveNotionConnection('user-123', 'page-abc', 'token-xyz');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptVaultPageId).toBe('page-abc');
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBe('2025-01-01T12:00:00.000Z');
        expect(result.value.updatedAt).toBe('2025-01-01T12:00:00.000Z');
      }
    });

    it('updates existing connection preserving createdAt', async () => {
      // First save
      await saveNotionConnection('user-123', 'page-abc', 'token-old');

      // Advance time
      vi.setSystemTime(new Date('2025-01-02T12:00:00Z'));

      // Update
      const result = await saveNotionConnection('user-123', 'page-new', 'token-new');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptVaultPageId).toBe('page-new');
        expect(result.value.createdAt).toBe('2025-01-01T12:00:00.000Z'); // Preserved
        expect(result.value.updatedAt).toBe('2025-01-02T12:00:00.000Z'); // Updated
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Firestore unavailable') });

      const result = await saveNotionConnection('user-123', 'page-abc', 'token-xyz');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to save connection');
      }
    });
  });

  describe('getNotionConnection', () => {
    it('returns null for non-existent user', async () => {
      const result = await getNotionConnection('unknown-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns connection for existing user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token-xyz');

      const result = await getNotionConnection('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.promptVaultPageId).toBe('page-abc');
        expect(result.value?.connected).toBe(true);
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Firestore unavailable') });

      const result = await getNotionConnection('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('getNotionToken', () => {
    it('returns null for non-existent user', async () => {
      const result = await getNotionToken('unknown-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns token for connected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token-xyz');

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('token-xyz');
      }
    });

    it('returns null for disconnected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token-xyz');
      await disconnectNotion('user-123');

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Firestore unavailable') });

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('isNotionConnected', () => {
    it('returns false for non-existent user', async () => {
      const result = await isNotionConnected('unknown-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true for connected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token-xyz');

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for disconnected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token-xyz');
      await disconnectNotion('user-123');

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Firestore unavailable') });

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('disconnectNotion', () => {
    it('disconnects connected user', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token-xyz');

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
        expect(result.value.promptVaultPageId).toBe('page-abc');
      }
    });

    it('returns error when user does not exist', async () => {
      const result = await disconnectNotion('unknown-user');

      // FakeFirestore's update throws for non-existent docs
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when Firestore fails', async () => {
      await saveNotionConnection('user-123', 'page-abc', 'token-xyz');
      fakeFirestore.configure({ errorToThrow: new Error('Firestore unavailable') });

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('handles disconnecting user with incomplete existing data', async () => {
      // Seed a document with missing promptVaultPageId and createdAt fields
      fakeFirestore.seedCollection('notion_connections', [
        {
          id: 'user-incomplete',
          data: {
            userId: 'user-incomplete',
            notionToken: 'token-xyz',
            connected: true,
            updatedAt: '2024-12-01T00:00:00.000Z',
            // Missing promptVaultPageId and createdAt to trigger fallback branches
          },
        },
      ]);

      const result = await disconnectNotion('user-incomplete');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
        // Should use fallback empty string for missing promptVaultPageId
        expect(result.value.promptVaultPageId).toBe('');
        // Should use fallback current time for missing createdAt
        expect(result.value.createdAt).toBe('2025-01-01T12:00:00.000Z');
        expect(result.value.updatedAt).toBe('2025-01-01T12:00:00.000Z');
      }
    });
  });
});
