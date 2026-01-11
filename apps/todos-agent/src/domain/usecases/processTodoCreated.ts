import type { Result } from '@intexuraos/common-core';
import type { Todo } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface ProcessTodoCreatedDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function processTodoCreated(
  deps: ProcessTodoCreatedDeps,
  todoId: string
): Promise<Result<Todo, TodoError>> {
  deps.logger.info({ todoId }, 'Processing todo created event');

  const findResult = await deps.todoRepository.findById(todoId);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Todo not found' } };
  }

  const todo = findResult.value;

  if (todo.status !== 'processing') {
    deps.logger.warn(
      { todoId, currentStatus: todo.status },
      'Todo is not in processing status, skipping'
    );
    return { ok: true, value: todo };
  }

  const updatedTodo: Todo = {
    ...todo,
    status: 'pending',
    updatedAt: new Date(),
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId }, 'Todo status changed to pending');
  }

  return result;
}
