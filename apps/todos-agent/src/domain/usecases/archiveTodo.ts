import type { Result } from '@intexuraos/common-core';
import type { Todo } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface ArchiveTodoDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function archiveTodo(
  deps: ArchiveTodoDeps,
  todoId: string,
  userId: string
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN' | 'INVALID_OPERATION'; message: string }>> {
  deps.logger.info({ todoId, userId }, 'Archiving todo');

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

  if (todo.status !== 'completed' && todo.status !== 'cancelled') {
    return {
      ok: false,
      error: {
        code: 'INVALID_OPERATION',
        message: 'Only completed or cancelled todos can be archived',
      },
    };
  }

  if (todo.archived) {
    return { ok: true, value: todo };
  }

  const updatedTodo: Todo = {
    ...todo,
    archived: true,
    updatedAt: new Date(),
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId }, 'Todo archived');
  }

  return result;
}
