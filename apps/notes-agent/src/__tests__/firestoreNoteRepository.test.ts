/**
 * Tests for Firestore note repository.
 * Tests CRUD operations for notes using in-memory Firestore fake.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { FirestoreNoteRepository } from '../infra/firestore/firestoreNoteRepository.js';
import type { NoteRepository } from '../domain/ports/noteRepository.js';
import type { CreateNoteInput } from '../domain/models/note.js';

function createTestInput(overrides: Partial<CreateNoteInput> = {}): CreateNoteInput {
  return {
    userId: 'user-123',
    title: 'Test Note',
    content: 'Test content',
    tags: ['test', 'sample'],
    source: 'whatsapp',
    sourceId: 'wa-msg-123',
    ...overrides,
  };
}

describe('FirestoreNoteRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: NoteRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = new FirestoreNoteRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('create', () => {
    it('creates a new note successfully', async () => {
      const input = createTestInput();

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.title).toBe('Test Note');
        expect(result.value.content).toBe('Test content');
        expect(result.value.tags).toEqual(['test', 'sample']);
        expect(result.value.source).toBe('whatsapp');
        expect(result.value.sourceId).toBe('wa-msg-123');
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('creates note with empty tags', async () => {
      const input = createTestInput({ tags: [] });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual([]);
      }
    });

    it('creates note with empty content', async () => {
      const input = createTestInput({ content: '' });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('generates unique ids for each note', async () => {
      const result1 = await repository.create(createTestInput());
      const result2 = await repository.create(createTestInput());

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.id).not.toBe(result2.value.id);
      }
    });

    it('sets createdAt and updatedAt to same value on create', async () => {
      const result = await repository.create(createTestInput());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt.getTime()).toBe(result.value.updatedAt.getTime());
      }
    });
  });

  describe('findById', () => {
    it('returns null for non-existent note', async () => {
      const result = await repository.findById('nonexistent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns note for existing id', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe(createResult.value.id);
        expect(result.value?.title).toBe('Test Note');
      }
    });

    it('returns note with correct date types', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('findByUserId', () => {
    it('returns empty array for user with no notes', async () => {
      const result = await repository.findByUserId('nonexistent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns notes for specified user only', async () => {
      await repository.create(createTestInput({ userId: 'user-A', title: 'Note A1' }));
      await repository.create(createTestInput({ userId: 'user-B', title: 'Note B1' }));
      await repository.create(createTestInput({ userId: 'user-A', title: 'Note A2' }));

      const resultA = await repository.findByUserId('user-A');
      const resultB = await repository.findByUserId('user-B');

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.value).toHaveLength(2);
        expect(resultB.value).toHaveLength(1);
        expect(resultA.value.every((n) => n.userId === 'user-A')).toBe(true);
        expect(resultB.value.every((n) => n.userId === 'user-B')).toBe(true);
      }
    });

    it('returns all notes for user', async () => {
      await repository.create(createTestInput({ title: 'First' }));
      await repository.create(createTestInput({ title: 'Second' }));
      await repository.create(createTestInput({ title: 'Third' }));

      const result = await repository.findByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        const titles = result.value.map((n) => n.title);
        expect(titles).toContain('First');
        expect(titles).toContain('Second');
        expect(titles).toContain('Third');
      }
    });
  });

  describe('update', () => {
    it('returns NOT_FOUND error for non-existent note', async () => {
      const result = await repository.update('nonexistent-id', { title: 'New Title' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Note not found');
      }
    });

    it('updates title only', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, { title: 'Updated Title' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated Title');
        expect(result.value.content).toBe('Test content');
        expect(result.value.tags).toEqual(['test', 'sample']);
      }
    });

    it('updates content only', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, { content: 'Updated content' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Test Note');
        expect(result.value.content).toBe('Updated content');
      }
    });

    it('updates tags only', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, { tags: ['new', 'tags'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual(['new', 'tags']);
        expect(result.value.title).toBe('Test Note');
      }
    });

    it('updates multiple fields at once', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, {
        title: 'New Title',
        content: 'New content',
        tags: ['updated'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('New Title');
        expect(result.value.content).toBe('New content');
        expect(result.value.tags).toEqual(['updated']);
      }
    });

    it('updates updatedAt timestamp', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const originalUpdatedAt = createResult.value.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await repository.update(createResult.value.id, { title: 'Updated' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
        expect(result.value.createdAt.getTime()).toBe(createResult.value.createdAt.getTime());
      }
    });

    it('allows setting empty tags', async () => {
      const createResult = await repository.create(createTestInput({ tags: ['initial'] }));
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, { tags: [] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual([]);
      }
    });
  });

  describe('delete', () => {
    it('returns NOT_FOUND error for non-existent note', async () => {
      const result = await repository.delete('nonexistent-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Note not found');
      }
    });

    it('deletes existing note', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const deleteResult = await repository.delete(createResult.value.id);

      expect(deleteResult.ok).toBe(true);

      const findResult = await repository.findById(createResult.value.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toBeNull();
      }
    });

    it('does not affect other notes when deleting', async () => {
      const result1 = await repository.create(createTestInput({ title: 'Note 1' }));
      const result2 = await repository.create(createTestInput({ title: 'Note 2' }));
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      await repository.delete(result1.value.id);

      const findResult = await repository.findById(result2.value.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).not.toBeNull();
        expect(findResult.value?.title).toBe('Note 2');
      }
    });
  });
  describe('error handling', () => {
    it('returns STORAGE_ERROR when create fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection failed') });
      const result = await repository.create(createTestInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Connection failed');
      }
    });
    it('returns STORAGE_ERROR when findById fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });
      const result = await repository.findById('some-id');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });
    it('returns STORAGE_ERROR when findByUserId fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });
      const result = await repository.findByUserId('user-123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Query failed');
      }
    });
    it('returns STORAGE_ERROR when update fails due to Firestore error', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });
      const result = await repository.update(createResult.value.id, { title: 'New Title' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
    it('returns STORAGE_ERROR when delete fails due to Firestore error', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });
      const result = await repository.delete(createResult.value.id);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Delete failed');
      }
    });
  });
});
