/**
 * Tests for useTodos hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Todo } from '@/types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  archiveTodo: vi.fn(),
  unarchiveTodo: vi.fn(),
  cancelTodo: vi.fn(),
  addTodoItem: vi.fn(),
  updateTodoItem: vi.fn(),
  deleteTodoItem: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken } => ({
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/todosApi', () => ({
  listTodos: mocks.listTodos,
  createTodo: mocks.createTodo,
  updateTodo: mocks.updateTodo,
  deleteTodo: mocks.deleteTodo,
  archiveTodo: mocks.archiveTodo,
  unarchiveTodo: mocks.unarchiveTodo,
  cancelTodo: mocks.cancelTodo,
  addTodoItem: mocks.addTodoItem,
  updateTodoItem: mocks.updateTodoItem,
  deleteTodoItem: mocks.deleteTodoItem,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string =>
    err instanceof Error ? err.message : defaultMsg,
}));

import { useTodos } from '../useTodos.js';

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    userId: 'u',
    title: `Todo ${id}`,
    description: null,
    tags: [],
    priority: 'medium',
    dueDate: null,
    source: 'manual',
    sourceId: 's',
    status: 'pending',
    archived: false,
    items: [],
    completedAt: null,
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
    ...overrides,
  };
}

describe('useTodos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('tok');
  });

  it('happy path: loads todos on mount', async () => {
    const todos = [makeTodo('1'), makeTodo('2')];
    mocks.listTodos.mockResolvedValue(todos);

    const { result } = renderHook(() => useTodos());

    expect(result.current.loading).toBe(true);
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.todos).toEqual(todos);
    expect(result.current.error).toBeNull();
    expect(mocks.listTodos).toHaveBeenCalledWith('tok', {});
  });

  it('error path: surfaces API errors via error state', async () => {
    mocks.listTodos.mockRejectedValue(new Error('failed to list'));

    const { result } = renderHook(() => useTodos());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.error).toBe('failed to list');
    expect(result.current.todos).toEqual([]);
  });

  it('createTodo: prepends new todo and re-uses cached state', async () => {
    mocks.listTodos.mockResolvedValue([makeTodo('1')]);
    const created = makeTodo('2');
    mocks.createTodo.mockResolvedValue(created);

    const { result } = renderHook(() => useTodos());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => {
      await result.current.createTodo({
        title: 'new', tags: [], source: 'manual', sourceId: 's',
      });
    });

    expect(mocks.createTodo).toHaveBeenCalledWith('tok', expect.objectContaining({ title: 'new' }));
    expect(result.current.todos.map((t) => t.id)).toEqual(['2', '1']);
  });

  it('updateTodo replaces entry, deleteTodo removes entry', async () => {
    mocks.listTodos.mockResolvedValue([makeTodo('1'), makeTodo('2')]);
    mocks.updateTodo.mockResolvedValue(makeTodo('1', { title: 'updated' }));
    mocks.deleteTodo.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTodos());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => {
      await result.current.updateTodo('1', { title: 'updated' });
    });
    expect(result.current.todos[0]?.title).toBe('updated');

    await act(async () => {
      await result.current.deleteTodo('2');
    });
    expect(result.current.todos.map((t) => t.id)).toEqual(['1']);
  });

  it('refetches when filters change (refresh dependency)', async () => {
    mocks.listTodos.mockResolvedValue([]);

    const { result } = renderHook(() => useTodos());
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(mocks.listTodos).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setFilters({ status: 'completed' });
    });

    await waitFor(() => {
      expect(mocks.listTodos).toHaveBeenCalledTimes(2);
    });
    expect(mocks.listTodos).toHaveBeenLastCalledWith('tok', { status: 'completed' });
  });
});
