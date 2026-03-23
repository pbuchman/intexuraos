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
  const itemMap = new Map(todo.items.map((item) => [item.id, item]));
  const providedItemIds = new Set(input.itemIds);

  if (itemMap.size !== providedItemIds.size) {
    return {
      ok: false,
      error: { code: 'INVALID_OPERATION', message: 'Item count mismatch' },
    };
  }
  const reorderedItems = [];
  for (const [index, id] of input.itemIds.entries()) {
    const item = itemMap.get(id);
    if (item === undefined) {
      return {
        ok: false as const,
        error: { code: 'INVALID_OPERATION' as const, message: `Item ${id} not found` },
      };
    }
    reorderedItems.push({ ...item, position: index });
  }

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

