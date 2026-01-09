import { randomUUID } from 'crypto';
import type { Result } from '@intexuraos/common-core';
import type { Todo, TodoItem, CreateTodoItemInput } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface AddTodoItemDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function addTodoItem(
  deps: AddTodoItemDeps,
  todoId: string,
  userId: string,
  input: CreateTodoItemInput
): Promise<Result<Todo, TodoError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ todoId, userId }, 'Adding item to todo');

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
  const now = new Date();
  const maxPosition = Math.max(0, ...todo.items.map((item) => item.position));

  const newItem: TodoItem = {
    id: randomUUID(),
    title: input.title,
    status: 'pending',
    priority: input.priority ?? null,
    dueDate: input.dueDate ?? null,
    position: maxPosition + 1,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const updatedTodo: Todo = {
    ...todo,
    items: [...todo.items, newItem],
    status: todo.status === 'completed' ? 'in_progress' : todo.status,
    completedAt: todo.status === 'completed' ? null : todo.completedAt,
    updatedAt: now,
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId, itemId: newItem.id }, 'Item added to todo');
  }

  return result;
}
