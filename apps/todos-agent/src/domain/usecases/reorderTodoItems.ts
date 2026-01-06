import type { Result } from '@intexuraos/common-core';
import type { Todo, ReorderItemsInput } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface ReorderTodoItemsDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function reorderTodoItems(
  deps: ReorderTodoItemsDeps,
  todoId: string,
  userId: string,
  input: ReorderItemsInput
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN' | 'INVALID_OPERATION'; message: string }>> {
  deps.logger.info({ todoId, userId }, 'Reordering todo items');

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
  const existingItemIds = new Set(todo.items.map((item) => item.id));
  const providedItemIds = new Set(input.itemIds);

  if (existingItemIds.size !== providedItemIds.size) {
    return {
      ok: false,
      error: { code: 'INVALID_OPERATION', message: 'Item count mismatch' },
    };
  }

  for (const id of input.itemIds) {
    if (!existingItemIds.has(id)) {
      return {
        ok: false,
        error: { code: 'INVALID_OPERATION', message: `Item ${id} not found` },
      };
    }
  }

  const itemMap = new Map(todo.items.map((item) => [item.id, item]));
  const reorderedItems = input.itemIds.map((id, index) => {
    const item = itemMap.get(id);
    if (item === undefined) {
      throw new Error(`Item ${id} not found`);
    }
    return { ...item, position: index };
  });

  const updatedTodo: Todo = {
    ...todo,
    items: reorderedItems,
    updatedAt: new Date(),
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId }, 'Todo items reordered');
  }

  return result;
}
