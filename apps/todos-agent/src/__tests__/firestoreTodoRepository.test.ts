/**
 * Tests for Firestore todo repository.
 * Tests CRUD operations for todos using in-memory Firestore fake.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { FirestoreTodoRepository } from '../infra/firestore/firestoreTodoRepository.js';
import type { TodoRepository } from '../domain/ports/todoRepository.js';
import type { CreateTodoInput, Todo } from '../domain/models/todo.js';

function createTestInput(overrides: Partial<CreateTodoInput> = {}): CreateTodoInput {
  return {
    userId: 'user-123',
    title: 'Test Todo',
    tags: ['test', 'sample'],
    source: 'web',
    sourceId: 'web-123',
    ...overrides,
  };
}

describe('FirestoreTodoRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: TodoRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = new FirestoreTodoRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('create', () => {
    it('creates a new todo successfully', async () => {
      const input = createTestInput();

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.title).toBe('Test Todo');
        expect(result.value.tags).toEqual(['test', 'sample']);
        expect(result.value.source).toBe('web');
        expect(result.value.sourceId).toBe('web-123');
        expect(result.value.status).toBe('pending');
        expect(result.value.priority).toBe('medium');
        expect(result.value.archived).toBe(false);
        expect(result.value.items).toEqual([]);
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('creates todo with items', async () => {
      const input = createTestInput({
        items: [
          { title: 'Item 1' },
          { title: 'Item 2', priority: 'high' },
        ],
      });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(2);
        expect(result.value.items[0]?.title).toBe('Item 1');
        expect(result.value.items[0]?.status).toBe('pending');
        expect(result.value.items[1]?.priority).toBe('high');
      }
    });

    it('creates todo with priority and dueDate', async () => {
      const dueDate = new Date('2025-12-31');
      const input = createTestInput({
        priority: 'urgent',
        dueDate,
        description: 'Test description',
      });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.priority).toBe('urgent');
        expect(result.value.dueDate).toEqual(dueDate);
        expect(result.value.description).toBe('Test description');
      }
    });

    it('creates todo with empty tags', async () => {
      const input = createTestInput({ tags: [] });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual([]);
      }
    });

    it('generates unique ids for each todo', async () => {
      const result1 = await repository.create(createTestInput());
      const result2 = await repository.create(createTestInput());

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.id).not.toBe(result2.value.id);
      }
    });
  });

  describe('findById', () => {
    it('returns null for non-existent todo', async () => {
      const result = await repository.findById('nonexistent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns todo for existing id', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe(createResult.value.id);
        expect(result.value?.title).toBe('Test Todo');
      }
    });

    it('returns todo with correct date types', async () => {
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
    it('returns empty array for user with no todos', async () => {
      const result = await repository.findByUserId('nonexistent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns todos for specified user without filters', async () => {
      await repository.create(createTestInput({ userId: 'user-A', title: 'Todo A1' }));
      await repository.create(createTestInput({ userId: 'user-A', title: 'Todo A2' }));
      await repository.create(createTestInput({ userId: 'user-B', title: 'Todo B1' }));

      const resultA = await repository.findByUserId('user-A');

      expect(resultA.ok).toBe(true);
      if (resultA.ok) {
        expect(resultA.value).toHaveLength(2);
        expect(resultA.value.every((t) => t.userId === 'user-A')).toBe(true);
      }
    });

    it('returns todos for specified user only', async () => {
      await repository.create(createTestInput({ userId: 'user-A', title: 'Todo A1' }));
      await repository.create(createTestInput({ userId: 'user-B', title: 'Todo B1' }));
      await repository.create(createTestInput({ userId: 'user-A', title: 'Todo A2' }));

      const resultA = await repository.findByUserId('user-A');
      const resultB = await repository.findByUserId('user-B');

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.value).toHaveLength(2);
        expect(resultB.value).toHaveLength(1);
        expect(resultA.value.every((t) => t.userId === 'user-A')).toBe(true);
        expect(resultB.value.every((t) => t.userId === 'user-B')).toBe(true);
      }
    });

    it('filters by status', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findByUserId('user-123', { status: 'completed' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('filters by archived', async () => {
      await repository.create(createTestInput());

      const result = await repository.findByUserId('user-123', { archived: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('filters by priority', async () => {
      await repository.create(createTestInput({ priority: 'low' }));
      await repository.create(createTestInput({ priority: 'urgent' }));

      const result = await repository.findByUserId('user-123', { priority: 'urgent' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.priority).toBe('urgent');
      }
    });

    it('filters by tags', async () => {
      await repository.create(createTestInput({ tags: ['work'] }));
      await repository.create(createTestInput({ tags: ['personal'] }));

      const result = await repository.findByUserId('user-123', { tags: ['work'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.tags).toContain('work');
      }
    });
  });

  describe('update', () => {
    it('returns NOT_FOUND error for non-existent todo', async () => {
      const fakeTodo: Todo = {
        id: 'nonexistent-id',
        userId: 'user-123',
        title: 'Updated',
        description: null,
        tags: [],
        priority: 'medium',
        dueDate: null,
        source: 'web',
        sourceId: 'web-123',
        status: 'pending',
        archived: false,
        items: [],
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await repository.update('nonexistent-id', fakeTodo);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Todo not found');
      }
    });

    it('updates todo successfully', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updatedTodo: Todo = {
        ...createResult.value,
        title: 'Updated Title',
        tags: ['updated'],
        updatedAt: new Date(),
      };

      const result = await repository.update(createResult.value.id, updatedTodo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated Title');
        expect(result.value.tags).toEqual(['updated']);
      }
    });

    it('preserves items when updating', async () => {
      const createResult = await repository.create(createTestInput({
        items: [{ title: 'Item 1' }],
      }));
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updatedTodo: Todo = {
        ...createResult.value,
        title: 'Updated',
        updatedAt: new Date(),
      };

      const result = await repository.update(createResult.value.id, updatedTodo);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(1);
        expect(result.value.items[0]?.title).toBe('Item 1');
      }
    });
  });

  describe('delete', () => {
    it('returns NOT_FOUND error for non-existent todo', async () => {
      const result = await repository.delete('nonexistent-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Todo not found');
      }
    });

    it('deletes existing todo', async () => {
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

    it('does not affect other todos when deleting', async () => {
      const result1 = await repository.create(createTestInput({ title: 'Todo 1' }));
      const result2 = await repository.create(createTestInput({ title: 'Todo 2' }));
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      await repository.delete(result1.value.id);

      const findResult = await repository.findById(result2.value.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).not.toBeNull();
        expect(findResult.value?.title).toBe('Todo 2');
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

      const updatedTodo: Todo = { ...createResult.value, title: 'Updated', updatedAt: new Date() };
      const result = await repository.update(createResult.value.id, updatedTodo);

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
