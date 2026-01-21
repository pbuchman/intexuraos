import type { Result } from '@intexuraos/common-core';
import type { Todo, TodoItem, UpdateTodoItemInput } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface UpdateTodoItemDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

function computeTodoStatus(items: TodoItem[]): 'pending' | 'in_progress' | 'completed' {
  /* istanbul ignore next -- unreachable: called only when updating existing item, so items.length >= 1 */
  if (items.length === 0) {
    return 'pending';
  }

  const allCompleted = items.every((item) => item.status === 'completed');
  if (allCompleted) {
    return 'completed';
  }

  const anyCompleted = items.some((item) => item.status === 'completed');
  if (anyCompleted) {
    return 'in_progress';
  }

  return 'pending';
}

export async function updateTodoItem(
  deps: UpdateTodoItemDeps,
  todoId: string,
  itemId: string,
  userId: string,
  input: UpdateTodoItemInput
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ todoId, itemId, userId }, 'Updating todo item');

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
  const itemIndex = todo.items.findIndex((item) => item.id === itemId);

  if (itemIndex === -1) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Item not found' } };
  }

  const existingItem = todo.items[itemIndex];
  /* istanbul ignore next -- defensive: itemIndex validated above, noUncheckedIndexedAccess requires this check */
  if (existingItem === undefined) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Item not found' } };
  }

  const now = new Date();
  const isCompletingItem = input.status === 'completed' && existingItem.status !== 'completed';

  const updatedItem: TodoItem = {
    ...existingItem,
    title: input.title ?? existingItem.title,
    status: input.status ?? existingItem.status,
    priority: input.priority !== undefined ? input.priority : existingItem.priority,
    dueDate: input.dueDate !== undefined ? input.dueDate : existingItem.dueDate,
    completedAt: isCompletingItem ? now : existingItem.completedAt,
    updatedAt: now,
  };

  const updatedItems = [...todo.items];
  updatedItems[itemIndex] = updatedItem;

  const newTodoStatus =
    todo.status === 'cancelled' || todo.status === 'processing'
      ? todo.status
      : computeTodoStatus(updatedItems);
  const isTodoCompleting = newTodoStatus === 'completed' && todo.status !== 'completed';

  if (isTodoCompleting) {
    deps.logger.info(
      { todoId, itemId, previousStatus: todo.status, newStatus: newTodoStatus },
      'Item completion caused todo to transition to completed'
    );
  }

  const updatedTodo: Todo = {
    ...todo,
    items: updatedItems,
    status: newTodoStatus,
    completedAt: isTodoCompleting ? now : todo.completedAt,
    updatedAt: now,
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info(
      { todoId, itemId, newStatus: updatedItem.status, todoStatus: newTodoStatus },
      'Todo item updated'
    );
  }

  return result;
}
