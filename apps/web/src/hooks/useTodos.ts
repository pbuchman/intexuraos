import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  addTodoItem as addTodoItemApi,
  archiveTodo as archiveTodoApi,
  cancelTodo as cancelTodoApi,
  createTodo as createTodoApi,
  deleteTodo as deleteTodoApi,
  deleteTodoItem as deleteTodoItemApi,
  listTodos as listTodosApi,
  unarchiveTodo as unarchiveTodoApi,
  updateTodo as updateTodoApi,
  updateTodoItem as updateTodoItemApi,
  type ListTodosFilters,
} from '@/services/todosApi';
import type {
  CreateTodoItemRequest,
  CreateTodoRequest,
  Todo,
  UpdateTodoItemRequest,
  UpdateTodoRequest,
} from '@/types';

interface UseTodosResult {
  todos: Todo[];
  loading: boolean;
  error: string | null;
  filters: ListTodosFilters;
  setFilters: (filters: ListTodosFilters) => void;
  refresh: () => Promise<void>;
  createTodo: (request: CreateTodoRequest) => Promise<Todo>;
  updateTodo: (id: string, request: UpdateTodoRequest) => Promise<Todo>;
  deleteTodo: (id: string) => Promise<void>;
  archiveTodo: (id: string) => Promise<Todo>;
  unarchiveTodo: (id: string) => Promise<Todo>;
  cancelTodo: (id: string) => Promise<Todo>;
  addItem: (todoId: string, request: CreateTodoItemRequest) => Promise<Todo>;
  updateItem: (todoId: string, itemId: string, request: UpdateTodoItemRequest) => Promise<Todo>;
  deleteItem: (todoId: string, itemId: string) => Promise<Todo>;
}

export function useTodos(): UseTodosResult {
  const { getAccessToken } = useAuth();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListTodosFilters>({});

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listTodosApi(token, filters);
      setTodos(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load todos'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, filters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTodo = useCallback(
    async (request: CreateTodoRequest): Promise<Todo> => {
      const token = await getAccessToken();
      const newTodo = await createTodoApi(token, request);
      setTodos((prev) => [newTodo, ...prev]);
      return newTodo;
    },
    [getAccessToken]
  );

  const updateTodo = useCallback(
    async (id: string, request: UpdateTodoRequest): Promise<Todo> => {
      const token = await getAccessToken();
      const updated = await updateTodoApi(token, id, request);
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [getAccessToken]
  );

  const deleteTodo = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteTodoApi(token, id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
    },
    [getAccessToken]
  );

  const archiveTodo = useCallback(
    async (id: string): Promise<Todo> => {
      const token = await getAccessToken();
      const updated = await archiveTodoApi(token, id);
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [getAccessToken]
  );

  const unarchiveTodo = useCallback(
    async (id: string): Promise<Todo> => {
      const token = await getAccessToken();
      const updated = await unarchiveTodoApi(token, id);
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [getAccessToken]
  );

  const cancelTodo = useCallback(
    async (id: string): Promise<Todo> => {
      const token = await getAccessToken();
      const updated = await cancelTodoApi(token, id);
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [getAccessToken]
  );

  const addItem = useCallback(
    async (todoId: string, request: CreateTodoItemRequest): Promise<Todo> => {
      const token = await getAccessToken();
      const updated = await addTodoItemApi(token, todoId, request);
      setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
      return updated;
    },
    [getAccessToken]
  );

  const updateItem = useCallback(
    async (todoId: string, itemId: string, request: UpdateTodoItemRequest): Promise<Todo> => {
      const token = await getAccessToken();
      const updated = await updateTodoItemApi(token, todoId, itemId, request);
      setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
      return updated;
    },
    [getAccessToken]
  );

  const deleteItem = useCallback(
    async (todoId: string, itemId: string): Promise<Todo> => {
      const token = await getAccessToken();
      const updated = await deleteTodoItemApi(token, todoId, itemId);
      setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
      return updated;
    },
    [getAccessToken]
  );

  return {
    todos,
    loading,
    error,
    filters,
    setFilters,
    refresh,
    createTodo,
    updateTodo,
    deleteTodo,
    archiveTodo,
    unarchiveTodo,
    cancelTodo,
    addItem,
    updateItem,
    deleteItem,
  };
}
