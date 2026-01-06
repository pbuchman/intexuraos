/**
 * Tests for FakeNoteRepository.
 * Tests the in-memory fake implementation including error simulation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeNoteRepository } from '../infra/firestore/fakeNoteRepository.js';
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

describe('FakeNoteRepository', () => {
  let repository: FakeNoteRepository;

  beforeEach(() => {
    repository = new FakeNoteRepository();
  });

  describe('create', () => {
    it('creates a note with unique id', async () => {
      const result = await repository.create(createTestInput());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.title).toBe('Test Note');
      }
    });

    it('returns error when simulateNextError is set', async () => {
      repository.simulateNextError({ code: 'STORAGE_ERROR', message: 'Simulated error' });

      const result = await repository.create(createTestInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toBe('Simulated error');
      }
    });

    it('returns error when simulateMethodError is set for create', async () => {
      repository.simulateMethodError('create', { code: 'STORAGE_ERROR', message: 'Create failed' });

      const result = await repository.create(createTestInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Create failed');
      }
    });

    it('clears method error after use', async () => {
      repository.simulateMethodError('create', { code: 'STORAGE_ERROR', message: 'Once' });

      const result1 = await repository.create(createTestInput());
      const result2 = await repository.create(createTestInput());

      expect(result1.ok).toBe(false);
      expect(result2.ok).toBe(true);
    });
  });

  describe('findById', () => {
    it('returns null for non-existent note', async () => {
      const result = await repository.findById('nonexistent');

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
        expect(result.value?.title).toBe('Test Note');
      }
    });

    it('returns error when simulateMethodError is set for findById', async () => {
      repository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'Find failed' });

      const result = await repository.findById('any-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Find failed');
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

    it('returns notes sorted by createdAt descending', async () => {
      await repository.create(createTestInput({ title: 'First' }));
      await new Promise((r) => setTimeout(r, 10));
      await repository.create(createTestInput({ title: 'Second' }));
      await new Promise((r) => setTimeout(r, 10));
      await repository.create(createTestInput({ title: 'Third' }));

      const result = await repository.findByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value[0]?.title).toBe('Third');
        expect(result.value[2]?.title).toBe('First');
      }
    });

    it('returns error when simulateMethodError is set for findByUserId', async () => {
      repository.simulateMethodError('findByUserId', {
        code: 'STORAGE_ERROR',
        message: 'List failed',
      });

      const result = await repository.findByUserId('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('List failed');
      }
    });
  });

  describe('update', () => {
    it('returns NOT_FOUND for non-existent note', async () => {
      const result = await repository.update('nonexistent', { title: 'New' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('updates existing note', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, { title: 'Updated' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated');
      }
    });

    it('returns error when simulateMethodError is set for update', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      repository.simulateMethodError('update', { code: 'STORAGE_ERROR', message: 'Update failed' });

      const result = await repository.update(createResult.value.id, { title: 'New' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Update failed');
      }
    });

    it('returns error when simulateNextError is set', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      repository.simulateNextError({ code: 'STORAGE_ERROR', message: 'Generic error' });

      const result = await repository.update(createResult.value.id, { title: 'New' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Generic error');
      }
    });
  });

  describe('delete', () => {
    it('returns NOT_FOUND for non-existent note', async () => {
      const result = await repository.delete('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
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

    it('returns error when simulateMethodError is set for delete', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      repository.simulateMethodError('delete', { code: 'STORAGE_ERROR', message: 'Delete failed' });

      const result = await repository.delete(createResult.value.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Delete failed');
      }
    });

    it('returns error when simulateNextError is set', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      repository.simulateNextError({ code: 'STORAGE_ERROR', message: 'Generic delete error' });

      const result = await repository.delete(createResult.value.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Generic delete error');
      }
    });
  });

  describe('clear', () => {
    it('removes all notes', async () => {
      await repository.create(createTestInput({ title: 'Note 1' }));
      await repository.create(createTestInput({ title: 'Note 2' }));

      repository.clear();

      const result = await repository.findByUserId('user-123');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('getAll', () => {
    it('returns empty array when no notes exist', () => {
      const notes = repository.getAll();
      expect(notes).toEqual([]);
    });

    it('returns all notes', async () => {
      await repository.create(createTestInput({ title: 'Note 1' }));
      await repository.create(createTestInput({ title: 'Note 2' }));

      const notes = repository.getAll();

      expect(notes).toHaveLength(2);
      const titles = notes.map((n) => n.title);
      expect(titles).toContain('Note 1');
      expect(titles).toContain('Note 2');
    });
  });
});
