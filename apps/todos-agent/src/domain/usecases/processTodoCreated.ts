import type { Result } from '@intexuraos/common-core';
import type { Todo, TodoItem } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';
import type { TodoItemExtractionService } from '../ports/todoItemExtractionService.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface ProcessTodoCreatedDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
  todoItemExtractionService: TodoItemExtractionService;
}

const MAX_DESCRIPTION_LENGTH = 10000;

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

  const now = new Date();

  if (todo.description !== null && todo.description.trim().length > 0) {
    deps.logger.info(
      { todoId, descriptionLength: todo.description.length },
      'Extracting items from description using LLM'
    );

    const descriptionToProcess = todo.description.length > MAX_DESCRIPTION_LENGTH
      ? todo.description.slice(0, MAX_DESCRIPTION_LENGTH)
      : todo.description;

    if (todo.description.length > MAX_DESCRIPTION_LENGTH) {
      deps.logger.warn(
        { todoId, descriptionLength: todo.description.length, limit: MAX_DESCRIPTION_LENGTH },
        'Description exceeds limit, extraction truncated'
      );
    }

    const extractionResult = await deps.todoItemExtractionService.extractItems(
      todo.userId,
      descriptionToProcess
    );

    if (extractionResult.ok) {
      const extractedItems = extractionResult.value;

      if (extractedItems.length > 0) {
        deps.logger.info(
          { todoId, itemCount: extractedItems.length },
          'Adding extracted items to todo'
        );

        const maxPosition = Math.max(0, ...todo.items.map((item) => item.position));

        const newItems: TodoItem[] = extractedItems.map((item, index) => ({
          id: `${todo.id}-extracted-${String(index)}`,
          title: item.title,
          status: 'pending',
          priority: item.priority ?? null,
          dueDate: item.dueDate ?? null,
          position: maxPosition + 1 + index,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        }));

        const updatedTodo: Todo = {
          ...todo,
          items: [...todo.items, ...newItems],
          status: 'pending',
          updatedAt: now,
        };

        const result = await deps.todoRepository.update(todoId, updatedTodo);

        if (result.ok) {
          deps.logger.info(
            { todoId, itemsAdded: newItems.length },
            'Todo updated with extracted items'
          );
        }

        return result;
      } else {
        deps.logger.info(
          { todoId },
          'No actionable items found in description, adding informational item'
        );

        const maxPosition = Math.max(0, ...todo.items.map((item) => item.position));

        const informationalItem: TodoItem = {
          id: `${todo.id}-no-items-found`,
          title: 'No actionable items found in todo description',
          status: 'pending',
          priority: null,
          dueDate: null,
          position: maxPosition + 1,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };

        const updatedTodo: Todo = {
          ...todo,
          items: [...todo.items, informationalItem],
          status: 'pending',
          updatedAt: now,
        };

        const result = await deps.todoRepository.update(todoId, updatedTodo);

        if (result.ok) {
          deps.logger.info(
            { todoId },
            'Todo updated with informational item (no extraction results)'
          );
        }

        return result;
      }
    } else {
      const error = extractionResult.error;
      deps.logger.error(
        {
          todoId,
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details,
          userId: todo.userId,
        },
        'Failed to extract items from description, continuing without extraction'
      );

      const maxPosition = Math.max(0, ...todo.items.map((item) => item.position));

      const warningItem: TodoItem = {
        id: `${todo.id}-extraction-failed`,
        title: `Item extraction failed (${error.code})`,
        status: 'pending',
        priority: 'high',
        dueDate: null,
        position: maxPosition + 1,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const updatedTodo: Todo = {
        ...todo,
        items: [...todo.items, warningItem],
        status: 'pending',
        updatedAt: now,
      };

      const result = await deps.todoRepository.update(todoId, updatedTodo);

      if (result.ok) {
        deps.logger.info(
          { todoId, errorCode: error.code },
          'Todo updated with extraction failure warning item'
        );
      }

      return result;
    }
  }

  const updatedTodo: Todo = {
    ...todo,
    status: 'pending',
    updatedAt: now,
  };

  const result = await deps.todoRepository.update(todoId, updatedTodo);

  if (result.ok) {
    deps.logger.info({ todoId }, 'Todo status changed to pending');
  }

  return result;
}
