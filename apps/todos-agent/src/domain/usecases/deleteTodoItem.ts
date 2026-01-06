import type { Result } from '@intexuraos/common-core';
import type { Todo } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface DeleteTodoItemDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function deleteTodoItem(
  deps: DeleteTodoItemDeps,
  todoId: string,
  itemId: string,
  userId: string
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ todoId, itemId, userId }, 'Deleting todo item');

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
  const itemExists = todo.items.some((item) => item.id === itemId);

  if (!itemExists) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Item not found' } };
  }

  const updatedItems = todo.items.filter((item) => item.id !== itemId);

  const updatedTodo: Todo = {
    ...todo,
    items: updatedItems,
    updatedAt: new Date(),
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId, itemId }, 'Todo item deleted');
  }

  return result;
}
