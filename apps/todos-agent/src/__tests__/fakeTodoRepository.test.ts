import { describe, it, expect, beforeEach } from 'vitest';
import { FakeTodoRepository } from '../infra/firestore/fakeTodoRepository.js';

describe('FakeTodoRepository', () => {
  let repo: FakeTodoRepository;

  beforeEach(() => {
    repo = new FakeTodoRepository();
  });

  describe('create', () => {
    it('creates a todo with generated id', async () => {
      const result = await repo.create({
        userId: 'user-1',
        title: 'Test',
        tags: ['test'],
        source: 'web',
        sourceId: 'src-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.title).toBe('Test');
        expect(result.value.status).toBe('pending');
        expect(result.value.priority).toBe('medium');
      }
    });

    it('creates items with correct positions', async () => {
      const result = await repo.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }, { title: 'Item 2' }],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items[0]?.position).toBe(0);
        expect(result.value.items[1]?.position).toBe(1);
      }
    });
  });

  describe('findById', () => {
    it('returns null for non-existent todo', async () => {
      const result = await repo.findById('non-existent');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns existing todo', async () => {
      const createResult = await repo.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repo.findById(createResult.value.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.id).toBe(createResult.value.id);
      }
    });
  });

  describe('findByUserId', () => {
    it('returns only user todos', async () => {
      await repo.create({
        userId: 'user-1',
        title: 'User 1 Todo',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      await repo.create({
        userId: 'user-2',
        title: 'User 2 Todo',
        tags: [],
        source: 'web',
        sourceId: 'src-2',
      });

      const result = await repo.findByUserId('user-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe('User 1 Todo');
      }
    });

    it('filters by status', async () => {
      const createResult = await repo.create({
        userId: 'user-1',
        title: 'Pending',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.status = 'completed';
      await repo.update(todo.id, todo);

      const pendingResult = await repo.findByUserId('user-1', { status: 'pending' });
      expect(pendingResult.ok).toBe(true);
      if (pendingResult.ok) {
        expect(pendingResult.value).toHaveLength(0);
      }

      const completedResult = await repo.findByUserId('user-1', { status: 'completed' });
      expect(completedResult.ok).toBe(true);
      if (completedResult.ok) {
        expect(completedResult.value).toHaveLength(1);
      }
    });

    it('filters by archived', async () => {
      const createResult = await repo.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.archived = true;
      await repo.update(todo.id, todo);

      const activeResult = await repo.findByUserId('user-1', { archived: false });
      expect(activeResult.ok).toBe(true);
      if (activeResult.ok) {
        expect(activeResult.value).toHaveLength(0);
      }

      const archivedResult = await repo.findByUserId('user-1', { archived: true });
      expect(archivedResult.ok).toBe(true);
      if (archivedResult.ok) {
        expect(archivedResult.value).toHaveLength(1);
      }
    });

    it('filters by tags', async () => {
      await repo.create({
        userId: 'user-1',
        title: 'Work Todo',
        tags: ['work', 'urgent'],
        source: 'web',
        sourceId: 'src-1',
      });
      await repo.create({
        userId: 'user-1',
        title: 'Personal Todo',
        tags: ['personal'],
        source: 'web',
        sourceId: 'src-2',
      });

      const result = await repo.findByUserId('user-1', { tags: ['work'] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe('Work Todo');
      }
    });

    it('sorts by createdAt descending', async () => {
      await repo.create({
        userId: 'user-1',
        title: 'First',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await repo.create({
        userId: 'user-1',
        title: 'Second',
        tags: [],
        source: 'web',
        sourceId: 'src-2',
      });

      const result = await repo.findByUserId('user-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.title).toBe('Second');
        expect(result.value[1]?.title).toBe('First');
      }
    });
  });

  describe('update', () => {
    it('updates existing todo', async () => {
      const createResult = await repo.create({
        userId: 'user-1',
        title: 'Original',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updated = { ...createResult.value, title: 'Updated' };
      const result = await repo.update(createResult.value.id, updated);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated');
      }
    });

    it('returns NOT_FOUND for non-existent todo', async () => {
      const result = await repo.update('non-existent', {
        id: 'non-existent',
        userId: 'user-1',
        title: 'Test',
        description: null,
        tags: [],
        priority: 'medium',
        dueDate: null,
        source: 'web',
        sourceId: 'src-1',
        status: 'pending',
        archived: false,
        items: [],
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('delete', () => {
    it('deletes existing todo', async () => {
      const createResult = await repo.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repo.delete(createResult.value.id);
      expect(result.ok).toBe(true);
      expect(repo.getAll()).toHaveLength(0);
    });

    it('returns NOT_FOUND for non-existent todo', async () => {
      const result = await repo.delete('non-existent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('error simulation', () => {
    it('simulateNextError returns error on next call', async () => {
      repo.simulateNextError({ code: 'STORAGE_ERROR', message: 'Test error' });

      const result = await repo.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }

      const secondResult = await repo.create({
        userId: 'user-1',
        title: 'Test 2',
        tags: [],
        source: 'web',
        sourceId: 'src-2',
      });
      expect(secondResult.ok).toBe(true);
    });

    it('simulateMethodError returns error for specific method', async () => {
      repo.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

      const createResult = await repo.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);

      const findResult = await repo.findById('any-id');
      expect(findResult.ok).toBe(false);
      if (!findResult.ok) {
        expect(findResult.error.code).toBe('STORAGE_ERROR');
      }
    });
  });

  describe('helper methods', () => {
    it('clear removes all todos', async () => {
      await repo.create({
        userId: 'user-1',
        title: 'Test 1',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      await repo.create({
        userId: 'user-1',
        title: 'Test 2',
        tags: [],
        source: 'web',
        sourceId: 'src-2',
      });

      repo.clear();
      expect(repo.getAll()).toHaveLength(0);
    });

    it('getAll returns all todos', async () => {
      await repo.create({
        userId: 'user-1',
        title: 'Test 1',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      await repo.create({
        userId: 'user-2',
        title: 'Test 2',
        tags: [],
        source: 'web',
        sourceId: 'src-2',
      });

      expect(repo.getAll()).toHaveLength(2);
    });
  });
});
