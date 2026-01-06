import type { Result } from '@intexuraos/common-core';
import type { Todo } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface GetTodoDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function getTodo(
  deps: GetTodoDeps,
  todoId: string,
  userId: string
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ todoId, userId }, 'Getting todo');

  const result = await deps.todoRepository.findById(todoId);

  if (!result.ok) {
    return result;
  }

  if (result.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Todo not found' } };
  }

  if (result.value.userId !== userId) {
    deps.logger.warn({ todoId, userId, ownerId: result.value.userId }, 'Access denied to todo');
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } };
  }

  return { ok: true, value: result.value };
}
