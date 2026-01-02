/**
 * Tests for Firestore action filters repository.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreActionFiltersRepository } from '../../../infra/firestore/actionFiltersRepository.js';
import type { ActionFiltersRepository } from '../../../domain/ports/actionFiltersRepository.js';

describe('FirestoreActionFiltersRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ActionFiltersRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createFirestoreActionFiltersRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getByUserId', () => {
    it('returns null for non-existent user', async () => {
      const result = await repository.getByUserId('user-123');
      expect(result).toBeNull();
    });

    it('returns filters data after addSavedFilter creates document', async () => {
      await repository.addSavedFilter('user-123', { name: 'Test Filter' });

      const result = await repository.getByUserId('user-123');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('user-123');
      expect(result?.options.status).toEqual([]);
      expect(result?.options.type).toEqual([]);
      expect(result?.savedFilters).toHaveLength(1);
    });

    it('handles partial document data gracefully', async () => {
      const db = fakeFirestore as unknown as {
        collection: (name: string) => {
          doc: (id: string) => { set: (data: object) => Promise<void> };
        };
      };
      await db.collection('actions_filters').doc('user-partial').set({
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repository.getByUserId('user-partial');

      expect(result).not.toBeNull();
      expect(result?.options.status).toEqual([]);
      expect(result?.options.type).toEqual([]);
      expect(result?.savedFilters).toEqual([]);
    });
  });

  describe('addOption', () => {
    it('adds option to empty user document', async () => {
      await repository.addOption('user-123', 'status', 'pending');

      const result = await repository.getByUserId('user-123');
      expect(result?.options.status).toContain('pending');
    });

    it('adds type option and preserves it', async () => {
      await repository.addOption('user-123', 'type', 'research');

      const result = await repository.getByUserId('user-123');
      expect(result?.options.type).toContain('research');
    });

    it('does not duplicate existing option value', async () => {
      await repository.addOption('user-123', 'status', 'pending');
      await repository.addOption('user-123', 'status', 'pending');

      const result = await repository.getByUserId('user-123');
      expect(result?.options.status).toEqual(['pending']);
    });
  });

  describe('addOptions', () => {
    it('adds multiple options and stores them in nested structure', async () => {
      await repository.addOptions('user-123', { status: 'pending', type: 'todo' });

      const result = await repository.getByUserId('user-123');
      expect(result?.options.status).toContain('pending');
      expect(result?.options.type).toContain('todo');
    });

    it('merges with existing options', async () => {
      await repository.addOption('user-123', 'status', 'pending');
      await repository.addOptions('user-123', { status: 'completed', type: 'research' });

      const result = await repository.getByUserId('user-123');
      expect(result?.options.status).toContain('pending');
      expect(result?.options.status).toContain('completed');
      expect(result?.options.type).toContain('research');
    });
  });

  describe('addSavedFilter', () => {
    it('creates saved filter for new user', async () => {
      const savedFilter = await repository.addSavedFilter('user-123', { name: 'My Filter' });

      expect(savedFilter.id).toBeDefined();
      expect(savedFilter.name).toBe('My Filter');
      expect(savedFilter.createdAt).toBeDefined();
    });

    it('creates saved filter with status', async () => {
      const savedFilter = await repository.addSavedFilter('user-123', {
        name: 'Pending Items',
        status: 'pending',
      });

      expect(savedFilter.name).toBe('Pending Items');
      expect(savedFilter.status).toBe('pending');
    });

    it('creates saved filter with type', async () => {
      const savedFilter = await repository.addSavedFilter('user-123', {
        name: 'Research Only',
        type: 'research',
      });

      expect(savedFilter.name).toBe('Research Only');
      expect(savedFilter.type).toBe('research');
    });

    it('creates saved filter with status and type', async () => {
      const savedFilter = await repository.addSavedFilter('user-123', {
        name: 'Active Research',
        status: 'pending',
        type: 'research',
      });

      expect(savedFilter.status).toBe('pending');
      expect(savedFilter.type).toBe('research');
    });

    it('returns filter with unique id', async () => {
      const filter1 = await repository.addSavedFilter('user-123', { name: 'Filter 1' });
      const filter2 = await repository.addSavedFilter('user-456', { name: 'Filter 2' });

      expect(filter1.id).not.toBe(filter2.id);
    });
  });

  describe('deleteSavedFilter', () => {
    it('throws error for non-existent user', async () => {
      await expect(repository.deleteSavedFilter('user-123', 'filter-id')).rejects.toThrow(
        'Filter data not found for user'
      );
    });

    it('throws error for non-existent filter', async () => {
      const savedFilter = await repository.addSavedFilter('user-123', { name: 'Existing Filter' });

      await expect(
        repository.deleteSavedFilter('user-123', 'nonexistent-id-' + savedFilter.id.slice(0, 4))
      ).rejects.toThrow('Saved filter not found');
    });

    it('deletes existing filter', async () => {
      const savedFilter = await repository.addSavedFilter('user-123', { name: 'To Delete' });

      await repository.deleteSavedFilter('user-123', savedFilter.id);

      const result = await repository.getByUserId('user-123');
      expect(result?.savedFilters).toHaveLength(0);
    });

    it('throws error when deleting from document with no savedFilters array', async () => {
      const db = fakeFirestore as unknown as {
        collection: (name: string) => {
          doc: (id: string) => { set: (data: object) => Promise<void> };
        };
      };
      await db
        .collection('actions_filters')
        .doc('user-empty')
        .set({
          options: { status: [], type: [] },
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

      await expect(repository.deleteSavedFilter('user-empty', 'any-id')).rejects.toThrow(
        'Saved filter not found'
      );
    });
  });
});
