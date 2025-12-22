/**
 * Tests for FirestoreNotionConnectionRepository.
 *
 * Uses real Firestore implementation against emulator.
 */
import { describe, it, expect } from 'vitest';
import { FirestoreNotionConnectionRepository } from '../notionConnectionRepository.js';

describe('FirestoreNotionConnectionRepository', () => {
  function createRepo(): FirestoreNotionConnectionRepository {
    return new FirestoreNotionConnectionRepository();
  }

  // Use dynamic IDs to avoid test pollution (emulator clear may race with test execution)
  const pageId = 'page-abc-123';
  const token = 'secret_notion_token';

  function uniqueUserId(): string {
    return `user-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  }

  describe('saveConnection', () => {
    it('creates a new connection when none exists', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      const result = await repo.saveConnection(userId, pageId, token);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptVaultPageId).toBe(pageId);
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('updates an existing connection preserving createdAt', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      // Create initial connection
      await repo.saveConnection(userId, pageId, token);

      // Get initial timestamps
      const firstResult = await repo.getConnection(userId);
      expect(firstResult.ok).toBe(true);
      const firstCreatedAt = firstResult.ok ? firstResult.value?.createdAt : undefined;

      // Update connection
      const newPageId = 'page-new-456';
      const updateResult = await repo.saveConnection(userId, newPageId, token);

      expect(updateResult.ok).toBe(true);
      if (updateResult.ok) {
        expect(updateResult.value.promptVaultPageId).toBe(newPageId);
        expect(updateResult.value.createdAt).toBe(firstCreatedAt);
      }
    });
  });

  describe('getConnection', () => {
    it('returns null when no connection exists', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      const result = await repo.getConnection(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns connection when it exists', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      await repo.saveConnection(userId, pageId, token);

      const result = await repo.getConnection(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.promptVaultPageId).toBe(pageId);
        expect(result.value?.connected).toBe(true);
      }
    });
  });

  describe('disconnectConnection', () => {
    it('marks connection as disconnected', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      await repo.saveConnection(userId, pageId, token);

      const result = await repo.disconnectConnection(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
        expect(result.value.promptVaultPageId).toBe(pageId);
      }
    });

    it('returns error when no connection exists', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.disconnectConnection('non-existent-user');

      // Firestore update() on non-existent doc throws, which causes INTERNAL_ERROR
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('isConnected', () => {
    it('returns false when no connection exists', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      const result = await repo.isConnected(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true when connected', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      await repo.saveConnection(userId, pageId, token);

      const result = await repo.isConnected(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false when disconnected', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      await repo.saveConnection(userId, pageId, token);
      await repo.disconnectConnection(userId);

      const result = await repo.isConnected(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('getToken', () => {
    it('returns null when no connection exists', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      const result = await repo.getToken(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns token when connected', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      await repo.saveConnection(userId, pageId, token);

      const result = await repo.getToken(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(token);
      }
    });

    it('returns null when disconnected', async (): Promise<void> => {
      const repo = createRepo();
      const userId = uniqueUserId();

      await repo.saveConnection(userId, pageId, token);
      await repo.disconnectConnection(userId);

      const result = await repo.getToken(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });
});
