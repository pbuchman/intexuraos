import type { Result } from '@intexuraos/common-core';
import type { Todo, CreateTodoInput, TodoFilters } from '../models/todo.js';

export type TodoErrorCode = 'NOT_FOUND' | 'STORAGE_ERROR' | 'INVALID_OPERATION';

export interface TodoError {
  code: TodoErrorCode;
  message: string;
}

export interface TodoRepository {
  create(input: CreateTodoInput): Promise<Result<Todo, TodoError>>;
  findById(id: string): Promise<Result<Todo | null, TodoError>>;
  findByUserId(userId: string, filters?: TodoFilters): Promise<Result<Todo[], TodoError>>;
  update(id: string, todo: Todo): Promise<Result<Todo, TodoError>>;
  delete(id: string): Promise<Result<void, TodoError>>;
}
