import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  Todo,
  TodoStatus,
  TodoPriority,
  CreateTodoRequest,
  UpdateTodoRequest,
  CreateTodoItemRequest,
  UpdateTodoItemRequest,
} from '@/types';

export interface ListTodosFilters {
  status?: TodoStatus;
  archived?: boolean;
  priority?: TodoPriority;
  tags?: string[];
}

function buildQueryString(filters: ListTodosFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== undefined) {
    params.set('status', filters.status);
  }
  if (filters.archived !== undefined) {
    params.set('archived', String(filters.archived));
  }
  if (filters.priority !== undefined) {
    params.set('priority', filters.priority);
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    params.set('tags', filters.tags.join(','));
  }
  const query = params.toString();
  return query !== '' ? `?${query}` : '';
}

export async function listTodos(
  accessToken: string,
  filters: ListTodosFilters = {}
): Promise<Todo[]> {
  const query = buildQueryString(filters);
  return await apiRequest<Todo[]>(config.todosAgentUrl, `/todos${query}`, accessToken);
}

export async function createTodo(
  accessToken: string,
  request: CreateTodoRequest
): Promise<Todo> {
  return await apiRequest<Todo>(config.todosAgentUrl, '/todos', accessToken, {
    method: 'POST',
    body: request,
  });
}

export async function getTodo(accessToken: string, id: string): Promise<Todo> {
  return await apiRequest<Todo>(config.todosAgentUrl, `/todos/${id}`, accessToken);
}

export async function updateTodo(
  accessToken: string,
  id: string,
  request: UpdateTodoRequest
): Promise<Todo> {
  return await apiRequest<Todo>(config.todosAgentUrl, `/todos/${id}`, accessToken, {
    method: 'PATCH',
    body: request,
  });
}

export async function deleteTodo(accessToken: string, id: string): Promise<void> {
  await apiRequest<Record<string, never>>(config.todosAgentUrl, `/todos/${id}`, accessToken, {
    method: 'DELETE',
  });
}

export async function archiveTodo(accessToken: string, id: string): Promise<Todo> {
  return await apiRequest<Todo>(config.todosAgentUrl, `/todos/${id}/archive`, accessToken, {
    method: 'POST',
  });
}

export async function unarchiveTodo(accessToken: string, id: string): Promise<Todo> {
  return await apiRequest<Todo>(config.todosAgentUrl, `/todos/${id}/unarchive`, accessToken, {
    method: 'POST',
  });
}

export async function addTodoItem(
  accessToken: string,
  todoId: string,
  request: CreateTodoItemRequest
): Promise<Todo> {
  return await apiRequest<Todo>(config.todosAgentUrl, `/todos/${todoId}/items`, accessToken, {
    method: 'POST',
    body: request,
  });
}

export async function updateTodoItem(
  accessToken: string,
  todoId: string,
  itemId: string,
  request: UpdateTodoItemRequest
): Promise<Todo> {
  return await apiRequest<Todo>(
    config.todosAgentUrl,
    `/todos/${todoId}/items/${itemId}`,
    accessToken,
    {
      method: 'PATCH',
      body: request,
    }
  );
}

export async function deleteTodoItem(
  accessToken: string,
  todoId: string,
  itemId: string
): Promise<Todo> {
  return await apiRequest<Todo>(
    config.todosAgentUrl,
    `/todos/${todoId}/items/${itemId}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

export async function reorderTodoItems(
  accessToken: string,
  todoId: string,
  itemIds: string[]
): Promise<Todo> {
  return await apiRequest<Todo>(
    config.todosAgentUrl,
    `/todos/${todoId}/items/reorder`,
    accessToken,
    {
      method: 'POST',
      body: { itemIds },
    }
  );
}
