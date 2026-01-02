/**
 * Tests for DataSource Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreDataSourceRepository } from '../infra/firestore/dataSourceRepository.js';

describe('FirestoreDataSourceRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: FirestoreDataSourceRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repository = new FirestoreDataSourceRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('create', () => {
    it('creates a new data source and returns it', async () => {
      const result = await repository.create('user-123', {
        title: 'Test Title',
        content: 'Test content',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.title).toBe('Test Title');
        expect(result.value.content).toBe('Test content');
        expect(result.value.id).toBeDefined();
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('handles errors gracefully', async () => {
      resetFirestore();

      const result = await repository.create('user-123', {
        title: 'Test',
        content: 'Content',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to create data source');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Firestore connection failed') });

      const result = await repository.create('user-123', {
        title: 'Test',
        content: 'Content',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Firestore connection failed');
      }

      fakeFirestore.configure({});
    });
  });

  describe('getById', () => {
    it('returns null for non-existent data source', async () => {
      const result = await repository.getById('non-existent', 'user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns data source for existing id and matching user', async () => {
      const createResult = await repository.create('user-123', {
        title: 'Test',
        content: 'Content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const result = await repository.getById(id, 'user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.title).toBe('Test');
      }
    });

    it('returns null when user id does not match', async () => {
      const createResult = await repository.create('user-123', {
        title: 'Test',
        content: 'Content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const result = await repository.getById(id, 'other-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection timeout') });

      const result = await repository.getById('some-id', 'user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to get data source');
      }

      fakeFirestore.configure({});
    });
  });

  describe('listByUserId', () => {
    it('returns empty array when no data sources exist', async () => {
      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns only data sources for the specified user', async () => {
      await repository.create('user-123', { title: 'Source 1', content: 'Content 1' });
      await repository.create('user-123', { title: 'Source 2', content: 'Content 2' });
      await repository.create('other-user', { title: 'Other', content: 'Other content' });

      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to list data sources');
      }

      fakeFirestore.configure({});
    });
  });

  describe('update', () => {
    it('updates an existing data source', async () => {
      const createResult = await repository.create('user-123', {
        title: 'Original',
        content: 'Original content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const result = await repository.update(id, 'user-123', {
        title: 'Updated',
        content: 'Updated content',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated');
        expect(result.value.content).toBe('Updated content');
      }
    });

    it('allows partial updates - title only', async () => {
      const createResult = await repository.create('user-123', {
        title: 'Original',
        content: 'Original content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const result = await repository.update(id, 'user-123', {
        title: 'New Title',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('New Title');
        expect(result.value.content).toBe('Original content');
      }
    });

    it('allows partial updates - content only', async () => {
      const createResult = await repository.create('user-123', {
        title: 'Original',
        content: 'Original content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const result = await repository.update(id, 'user-123', {
        content: 'New Content',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Original');
        expect(result.value.content).toBe('New Content');
      }
    });

    it('returns error for non-existent data source', async () => {
      const result = await repository.update('non-existent', 'user-123', {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Data source not found');
      }
    });

    it('returns error when user id does not match', async () => {
      const createResult = await repository.create('user-123', {
        title: 'Test',
        content: 'Content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const result = await repository.update(id, 'other-user', {
        title: 'Hacked',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Data source not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repository.update('some-id', 'user-123', {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to update data source');
      }

      fakeFirestore.configure({});
    });
  });

  describe('delete', () => {
    it('deletes an existing data source', async () => {
      const createResult = await repository.create('user-123', {
        title: 'To Delete',
        content: 'Content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const deleteResult = await repository.delete(id, 'user-123');

      expect(deleteResult.ok).toBe(true);

      const getResult = await repository.getById(id, 'user-123');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('returns error for non-existent data source', async () => {
      const result = await repository.delete('non-existent', 'user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Data source not found');
      }
    });

    it('returns error when user id does not match', async () => {
      const createResult = await repository.create('user-123', {
        title: 'Test',
        content: 'Content',
      });

      const id = createResult.ok ? createResult.value.id : '';
      const result = await repository.delete(id, 'other-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Data source not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repository.delete('some-id', 'user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to delete data source');
      }

      fakeFirestore.configure({});
    });
  });
});
