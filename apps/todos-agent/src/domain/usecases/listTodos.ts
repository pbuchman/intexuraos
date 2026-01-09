import type { Result } from '@intexuraos/common-core';
import type { Todo, TodoFilters } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
}

export interface ListTodosDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function listTodos(
  deps: ListTodosDeps,
  userId: string,
  filters?: TodoFilters
): Promise<Result<Todo[], TodoError>> {
  deps.logger.info({ userId, filters }, 'Listing todos');

  return await deps.todoRepository.findByUserId(userId, filters);
}
