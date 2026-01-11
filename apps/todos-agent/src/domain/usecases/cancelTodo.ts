import type { Result } from '@intexuraos/common-core';
import type { Todo } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface CancelTodoDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function cancelTodo(
  deps: CancelTodoDeps,
  todoId: string,
  userId: string
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN' | 'INVALID_OPERATION'; message: string }>> {
  deps.logger.info({ todoId, userId }, 'Cancelling todo');

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

  const todo = findResult.value;

  if (todo.status === 'completed') {
    return {
      ok: false,
      error: {
        code: 'INVALID_OPERATION',
        message: 'Completed todos cannot be cancelled',
      },
    };
  }

  if (todo.status === 'cancelled') {
    return { ok: true, value: todo };
  }

  const updatedTodo: Todo = {
    ...todo,
    status: 'cancelled',
    updatedAt: new Date(),
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId }, 'Todo cancelled');
  }

  return result;
}
