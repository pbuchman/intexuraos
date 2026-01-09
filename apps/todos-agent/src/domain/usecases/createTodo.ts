import type { Result } from '@intexuraos/common-core';
import type { Todo, CreateTodoInput } from '../models/todo.js';
import type { TodoRepository, TodoError } from '../ports/todoRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface CreateTodoDeps {
  todoRepository: TodoRepository;
  logger: MinimalLogger;
}

export async function createTodo(
  deps: CreateTodoDeps,
  input: CreateTodoInput
): Promise<Result<Todo, TodoError>> {
  deps.logger.info({ userId: input.userId, source: input.source }, 'Creating todo');

  const result = await deps.todoRepository.create(input);

  if (result.ok) {
    deps.logger.info({ todoId: result.value.id }, 'Todo created');
  } else {
    deps.logger.error({ error: result.error }, 'Failed to create todo');
  }

  return result;
}
