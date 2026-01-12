import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  Todo,
  TodoItem,
  CreateTodoInput,
  TodoFilters,
  TodoStatus,
  TodoItemStatus,
  TodoPriority,
} from '../../domain/models/todo.js';
import type { TodoRepository, TodoError } from '../../domain/ports/todoRepository.js';

const COLLECTION = 'todos';

interface TodoItemDocument {
  id: string;
  title: string;
  status: TodoItemStatus;
  priority: TodoPriority | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TodoDocument {
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  priority: TodoPriority;
  dueDate: string | null;
  source: string;
  sourceId: string;
  status: TodoStatus;
  archived: boolean;
  items: TodoItemDocument[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toTodoItem(doc: TodoItemDocument): TodoItem {
  return {
    id: doc.id,
    title: doc.title,
    status: doc.status,
    priority: doc.priority,
    dueDate: doc.dueDate !== null ? new Date(doc.dueDate) : null,
    position: doc.position,
    completedAt: doc.completedAt !== null ? new Date(doc.completedAt) : null,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

function toTodo(id: string, doc: TodoDocument): Todo {
  return {
    id,
    userId: doc.userId,
    title: doc.title,
    description: doc.description,
    tags: doc.tags,
    priority: doc.priority,
    dueDate: doc.dueDate !== null ? new Date(doc.dueDate) : null,
    source: doc.source,
    sourceId: doc.sourceId,
    status: doc.status,
    archived: doc.archived,
    items: doc.items.map(toTodoItem),
    completedAt: doc.completedAt !== null ? new Date(doc.completedAt) : null,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

function toTodoItemDocument(item: TodoItem): TodoItemDocument {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    dueDate: item.dueDate !== null ? item.dueDate.toISOString() : null,
    position: item.position,
    completedAt: item.completedAt !== null ? item.completedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toTodoDocument(todo: Todo): TodoDocument {
  return {
    userId: todo.userId,
    title: todo.title,
    description: todo.description,
    tags: todo.tags,
    priority: todo.priority,
    dueDate: todo.dueDate !== null ? todo.dueDate.toISOString() : null,
    source: todo.source,
    sourceId: todo.sourceId,
    status: todo.status,
    archived: todo.archived,
    items: todo.items.map(toTodoItemDocument),
    completedAt: todo.completedAt !== null ? todo.completedAt.toISOString() : null,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
  };
}

export class FirestoreTodoRepository implements TodoRepository {
  async create(input: CreateTodoInput): Promise<Result<Todo, TodoError>> {
    try {
      const db = getFirestore();
      const now = new Date();
      const docRef = db.collection(COLLECTION).doc();

      const items: TodoItem[] = (input.items ?? []).map((itemInput, index) => ({
        id: `${docRef.id}-item-${String(index)}`,
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
        id: docRef.id,
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

      await docRef.set(toTodoDocument(todo));

      return { ok: true, value: todo };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to create todo') },
      };
    }
  }

  async findById(id: string): Promise<Result<Todo | null, TodoError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(id).get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      return { ok: true, value: toTodo(doc.id, doc.data() as TodoDocument) };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to find todo') },
      };
    }
  }

  async findByUserId(userId: string, filters?: TodoFilters): Promise<Result<Todo[], TodoError>> {
    try {
      const db = getFirestore();
      let query = db.collection(COLLECTION).where('userId', '==', userId);

      if (filters?.status !== undefined) {
        query = query.where('status', '==', filters.status);
      }

      if (filters?.archived !== undefined) {
        query = query.where('archived', '==', filters.archived);
      }

      if (filters?.priority !== undefined) {
        query = query.where('priority', '==', filters.priority);
      }

      query = query.orderBy('updatedAt', 'desc');

      const snapshot = await query.get();
      let todos = snapshot.docs.map((doc) => toTodo(doc.id, doc.data() as TodoDocument));

      if (filters?.tags !== undefined && filters.tags.length > 0) {
        const filterTags = filters.tags;
        todos = todos.filter((todo) => filterTags.some((tag) => todo.tags.includes(tag)));
      }

      return { ok: true, value: todos };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to list todos') },
      };
    }
  }

  async update(id: string, todo: Todo): Promise<Result<Todo, TodoError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Todo not found' } };
      }

      await docRef.set(toTodoDocument(todo));

      return { ok: true, value: todo };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to update todo') },
      };
    }
  }

  async delete(id: string): Promise<Result<void, TodoError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Todo not found' } };
      }

      await docRef.delete();
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to delete todo') },
      };
    }
  }
}
