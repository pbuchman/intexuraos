import { randomUUID } from 'crypto';
import type { Result } from '@intexuraos/common-core';
import type { Todo, TodoItem, CreateTodoInput, TodoFilters } from '../domain/models/todo.js';
import type { TodoRepository, TodoError } from '../domain/ports/todoRepository.js';

type MethodName = 'create' | 'findById' | 'findByUserId' | 'update' | 'delete';

export class FakeTodoRepository implements TodoRepository {
  private todos = new Map<string, Todo>();
  private nextError: TodoError | null = null;
  private methodErrors = new Map<MethodName, TodoError>();

  simulateNextError(error: TodoError): void {
    this.nextError = error;
  }

  simulateMethodError(method: MethodName, error: TodoError): void {
    this.methodErrors.set(method, error);
  }

  private checkError(method: MethodName): TodoError | null {
    const methodError = this.methodErrors.get(method);
    if (methodError !== undefined) {
      this.methodErrors.delete(method);
      return methodError;
    }
    const error = this.nextError;
    this.nextError = null;
    return error;
  }

  create(input: CreateTodoInput): Promise<Result<Todo, TodoError>> {
    const error = this.checkError('create');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    const now = new Date();
    const todoId = randomUUID();

    const items: TodoItem[] = (input.items ?? []).map((itemInput, index) => ({
      id: randomUUID(),
      title: itemInput.title,
      status: 'pending' as const,
      priority: itemInput.priority ?? null,
      dueDate: itemInput.dueDate ?? null,
      position: index,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }));

    const todo: Todo = {
      id: todoId,
      userId: input.userId,
      title: input.title,
      description: input.description ?? null,
      tags: input.tags,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ?? null,
      source: input.source,
      sourceId: input.sourceId,
      status: input.status ?? 'pending',
      archived: false,
      items,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.todos.set(todo.id, todo);
    return Promise.resolve({ ok: true, value: todo });
  }

  findById(id: string): Promise<Result<Todo | null, TodoError>> {
    const error = this.checkError('findById');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }
    const todo = this.todos.get(id);
    return Promise.resolve({ ok: true, value: todo ?? null });
  }

  findByUserId(userId: string, filters?: TodoFilters): Promise<Result<Todo[], TodoError>> {
    const error = this.checkError('findByUserId');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    let userTodos = Array.from(this.todos.values()).filter((t) => t.userId === userId);

    if (filters?.status !== undefined) {
      userTodos = userTodos.filter((t) => t.status === filters.status);
    }

    if (filters?.archived !== undefined) {
      userTodos = userTodos.filter((t) => t.archived === filters.archived);
    }

    if (filters?.priority !== undefined) {
      userTodos = userTodos.filter((t) => t.priority === filters.priority);
    }

    if (filters?.tags !== undefined && filters.tags.length > 0) {
      const filterTags = filters.tags;
      userTodos = userTodos.filter((t) => filterTags.some((tag) => t.tags.includes(tag)));
    }

    userTodos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return Promise.resolve({ ok: true, value: userTodos });
  }

  update(id: string, todo: Todo): Promise<Result<Todo, TodoError>> {
    const error = this.checkError('update');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    if (!this.todos.has(id)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Todo not found' },
      });
    }

    this.todos.set(id, todo);
    return Promise.resolve({ ok: true, value: todo });
  }

  delete(id: string): Promise<Result<void, TodoError>> {
    const error = this.checkError('delete');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    if (!this.todos.has(id)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Todo not found' },
      });
    }

    this.todos.delete(id);
    return Promise.resolve({ ok: true, value: undefined });
  }

  clear(): void {
    this.todos.clear();
  }

  getAll(): Todo[] {
    return Array.from(this.todos.values());
  }
}
