import type { Result } from '@intexuraos/common-core';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface DeleteTodoDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function deleteTodo(
  deps: DeleteTodoDeps,
  todoId: string,
  userId: string
): Promise<Result<void, TodoError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ todoId, userId }, 'Deleting todo');

  const findResult = await deps.todoRepository.findById(todoId);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Todo not found' } };
  }

  if (findResult.value.userId !== userId) {
    deps.logger.warn({ todoId, userId, ownerId: findResult.value.userId }, 'Access denied to todo');
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } };
  }

  const result = await deps.todoRepository.delete(todoId);

  if (result.ok) {
    deps.logger.info({ todoId }, 'Todo deleted');
  }

  return result;
}
