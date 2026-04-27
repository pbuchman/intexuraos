/**
 * Tests for todosApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTodos,
  createTodo,
  getTodo,
  updateTodo,
  deleteTodo,
  archiveTodo,
  unarchiveTodo,
  cancelTodo,
  addTodoItem,
  updateTodoItem,
  deleteTodoItem,
  reorderTodoItems,
} from '../todosApi.js';
import type { Todo, CreateTodoRequest } from '../../types/index.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    todosAgentUrl: 'https://todos.test',
  },
}));

const TOKEN = 'tok';

const sampleTodo: Todo = {
  id: 'todo-1',
  userId: 'user-1',
  title: 'Test',
  description: null,
  tags: [],
  priority: 'medium',
  dueDate: null,
  source: 'manual',
  sourceId: 'src-1',
  status: 'pending',
  archived: false,
  items: [],
  completedAt: null,
  createdAt: '2026-04-26T00:00:00Z',
  updatedAt: '2026-04-26T00:00:00Z',
};

describe('todosApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listTodos', () => {
    it('GETs /todos with no query when filters empty', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([sampleTodo]);

      const result = await listTodos(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://todos.test');
      expect(call?.[1]).toBe('/todos');
      expect(call?.[2]).toBe(TOKEN);
      expect(result).toEqual([sampleTodo]);
    });

    it('builds querystring from filters', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([]);

      await listTodos(TOKEN, {
        status: 'pending',
        archived: true,
        priority: 'high',
        tags: ['a', 'b'],
      });

      const call = vi.mocked(apiRequest).mock.calls[0];
      const path = call?.[1] ?? '';
      expect(path.startsWith('/todos?')).toBe(true);
      expect(path).toContain('status=pending');
      expect(path).toContain('archived=true');
      expect(path).toContain('priority=high');
      expect(path).toContain('tags=a%2Cb');
    });

    it('omits empty tags array', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([]);

      await listTodos(TOKEN, { tags: [] });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos');
    });
  });

  describe('createTodo (happy path)', () => {
    it('POSTs body to /todos', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      const req: CreateTodoRequest = {
        title: 'Test',
        tags: [],
        source: 'manual',
        sourceId: 'src-1',
      };
      const result = await createTodo(TOKEN, req);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos');
      expect(call?.[3]).toEqual({ method: 'POST', body: req });
      expect(result).toBe(sampleTodo);
    });
  });

  describe('getTodo', () => {
    it('GETs /todos/:id', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      await getTodo(TOKEN, 'todo-1');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos/todo-1');
    });
  });

  describe('updateTodo', () => {
    it('PATCHes /todos/:id with body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      await updateTodo(TOKEN, 'todo-1', { title: 'New' });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos/todo-1');
      expect(call?.[3]).toEqual({ method: 'PATCH', body: { title: 'New' } });
    });
  });

  describe('deleteTodo', () => {
    it('DELETEs /todos/:id', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({});

      await deleteTodo(TOKEN, 'todo-1');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos/todo-1');
      expect(call?.[3]).toEqual({ method: 'DELETE' });
    });
  });

  describe('archive/unarchive/cancel', () => {
    it.each([
      ['archive', archiveTodo, '/todos/todo-1/archive'],
      ['unarchive', unarchiveTodo, '/todos/todo-1/unarchive'],
      ['cancel', cancelTodo, '/todos/todo-1/cancel'],
    ])('POSTs to %s endpoint', async (_name, fn, expectedPath) => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      await fn(TOKEN, 'todo-1');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe(expectedPath);
      expect(call?.[3]).toEqual({ method: 'POST' });
    });
  });

  describe('item endpoints', () => {
    it('addTodoItem POSTs body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      await addTodoItem(TOKEN, 'todo-1', { title: 'sub' });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos/todo-1/items');
      expect(call?.[3]).toEqual({ method: 'POST', body: { title: 'sub' } });
    });

    it('updateTodoItem PATCHes body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      await updateTodoItem(TOKEN, 'todo-1', 'item-1', { status: 'completed' });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos/todo-1/items/item-1');
      expect(call?.[3]).toEqual({ method: 'PATCH', body: { status: 'completed' } });
    });

    it('deleteTodoItem DELETEs', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      await deleteTodoItem(TOKEN, 'todo-1', 'item-1');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos/todo-1/items/item-1');
      expect(call?.[3]).toEqual({ method: 'DELETE' });
    });

    it('reorderTodoItems POSTs itemIds', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleTodo);

      await reorderTodoItems(TOKEN, 'todo-1', ['a', 'b']);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/todos/todo-1/items/reorder');
      expect(call?.[3]).toEqual({ method: 'POST', body: { itemIds: ['a', 'b'] } });
    });
  });

  describe('error path', () => {
    it('propagates errors thrown by apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('boom'));

      await expect(listTodos(TOKEN)).rejects.toThrow('boom');
    });
  });
});
