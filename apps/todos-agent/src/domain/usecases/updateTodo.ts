import type { Result } from '@intexuraos/common-core';
import type { Todo, UpdateTodoInput } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface UpdateTodoDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function updateTodo(
  deps: UpdateTodoDeps,
  todoId: string,
  userId: string,
  input: UpdateTodoInput
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ todoId, userId }, 'Updating todo');

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

  const updatedTodo: Todo = {
    ...findResult.value,
    title: input.title ?? findResult.value.title,
    description: input.description !== undefined ? input.description : findResult.value.description,
    tags: input.tags ?? findResult.value.tags,
    priority: input.priority ?? findResult.value.priority,
    dueDate: input.dueDate !== undefined ? input.dueDate : findResult.value.dueDate,
    updatedAt: new Date(),
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId }, 'Todo updated');
  }

  return result;
}
