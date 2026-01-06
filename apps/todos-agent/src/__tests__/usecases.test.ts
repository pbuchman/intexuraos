import { describe, it, expect, beforeEach } from 'vitest';
import { FakeTodoRepository } from '../infra/firestore/fakeTodoRepository.js';
import { createTodo } from '../domain/usecases/createTodo.js';
import { getTodo } from '../domain/usecases/getTodo.js';
import { listTodos } from '../domain/usecases/listTodos.js';
import { updateTodo } from '../domain/usecases/updateTodo.js';
import { deleteTodo } from '../domain/usecases/deleteTodo.js';
import { addTodoItem } from '../domain/usecases/addTodoItem.js';
import { updateTodoItem } from '../domain/usecases/updateTodoItem.js';
import { deleteTodoItem } from '../domain/usecases/deleteTodoItem.js';
import { reorderTodoItems } from '../domain/usecases/reorderTodoItems.js';
import { archiveTodo } from '../domain/usecases/archiveTodo.js';
import { unarchiveTodo } from '../domain/usecases/unarchiveTodo.js';

const mockLogger = {
  info: (): void => {
    // No-op: test logger
  },
  warn: (): void => {
    // No-op: test logger
  },
  error: (): void => {
    // No-op: test logger
  },
};

describe('createTodo', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('creates a todo successfully', async () => {
    const result = await createTodo(
      { todoRepository, logger: mockLogger },
      {
        userId: 'user-1',
        title: 'Test Todo',
        tags: ['test'],
        source: 'web',
        sourceId: 'src-1',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Test Todo');
      expect(result.value.userId).toBe('user-1');
      expect(result.value.status).toBe('pending');
      expect(result.value.priority).toBe('medium');
      expect(result.value.archived).toBe(false);
    }
  });

  it('creates a todo with items', async () => {
    const result = await createTodo(
      { todoRepository, logger: mockLogger },
      {
        userId: 'user-1',
        title: 'Test Todo',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }, { title: 'Item 2' }],
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[0]?.title).toBe('Item 1');
      expect(result.value.items[1]?.title).toBe('Item 2');
    }
  });

  it('returns error on storage failure', async () => {
    todoRepository.simulateNextError({ code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await createTodo(
      { todoRepository, logger: mockLogger },
      {
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('getTodo', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns todo for owner', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await getTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(createResult.value.id);
    }
  });

  it('returns FORBIDDEN for non-owner', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await getTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'other-user'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await getTodo(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('listTodos', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('lists todos for user', async () => {
    await todoRepository.create({
      userId: 'user-1',
      title: 'Todo 1',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    await todoRepository.create({
      userId: 'user-1',
      title: 'Todo 2',
      tags: [],
      source: 'web',
      sourceId: 'src-2',
    });
    await todoRepository.create({
      userId: 'user-2',
      title: 'Other User Todo',
      tags: [],
      source: 'web',
      sourceId: 'src-3',
    });

    const result = await listTodos({ todoRepository, logger: mockLogger }, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('filters by status', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Todo 1',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);

    const result = await listTodos({ todoRepository, logger: mockLogger }, 'user-1', {
      status: 'completed',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });
});

describe('updateTodo', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('updates todo for owner', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Original',
      tags: ['old'],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await updateTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { title: 'Updated', tags: ['new'] }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Updated');
      expect(result.value.tags).toEqual(['new']);
    }
  });

  it('returns FORBIDDEN for non-owner', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await updateTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'other-user',
      { title: 'Hacked' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('deleteTodo', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('deletes todo for owner', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await deleteTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1'
    );

    expect(result.ok).toBe(true);
    expect(todoRepository.getAll()).toHaveLength(0);
  });

  it('returns FORBIDDEN for non-owner', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await deleteTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'other-user'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('addTodoItem', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('adds item to todo', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await addTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { title: 'New Item' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.title).toBe('New Item');
    }
  });

  it('reopens completed todo when item added', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const todo = createResult.value;
    todo.status = 'completed';
    todo.completedAt = new Date();
    await todoRepository.update(todo.id, todo);

    const result = await addTodoItem(
      { todoRepository, logger: mockLogger },
      todo.id,
      'user-1',
      { title: 'New Item' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('in_progress');
      expect(result.value.completedAt).toBeNull();
    }
  });
});

describe('updateTodoItem', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('updates item status', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      items: [{ title: 'Item 1' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const itemId = createResult.value.items[0]?.id;
    expect(itemId).toBeDefined();
    if (itemId === undefined) return;

    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      itemId,
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.status).toBe('completed');
      expect(result.value.items[0]?.completedAt).not.toBeNull();
    }
  });

  it('auto-completes parent when all items completed', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      items: [{ title: 'Item 1' }, { title: 'Item 2' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const item1Id = createResult.value.items[0]?.id;
    const item2Id = createResult.value.items[1]?.id;
    expect(item1Id).toBeDefined();
    expect(item2Id).toBeDefined();
    if (item1Id === undefined || item2Id === undefined) return;

    await updateTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      item1Id,
      'user-1',
      { status: 'completed' }
    );

    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      item2Id,
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('completed');
      expect(result.value.completedAt).not.toBeNull();
    }
  });

  it('returns NOT_FOUND for non-existent item', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'non-existent-item',
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('deleteTodoItem', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('deletes item from todo', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      items: [{ title: 'Item 1' }, { title: 'Item 2' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const itemId = createResult.value.items[0]?.id;
    expect(itemId).toBeDefined();
    if (itemId === undefined) return;

    const result = await deleteTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      itemId,
      'user-1'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
    }
  });
});

describe('reorderTodoItems', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('reorders items', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      items: [{ title: 'Item 1' }, { title: 'Item 2' }, { title: 'Item 3' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const items = createResult.value.items;
    const reversedIds = [items[2]?.id, items[1]?.id, items[0]?.id].filter(
      (id): id is string => id !== undefined
    );

    const result = await reorderTodoItems(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { itemIds: reversedIds }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.title).toBe('Item 3');
      expect(result.value.items[1]?.title).toBe('Item 2');
      expect(result.value.items[2]?.title).toBe('Item 1');
    }
  });

  it('returns INVALID_OPERATION for mismatched items', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      items: [{ title: 'Item 1' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await reorderTodoItems(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { itemIds: ['fake-id'] }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OPERATION');
    }
  });
});

describe('archiveTodo', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('archives completed todo', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const todo = createResult.value;
    todo.status = 'completed';
    await todoRepository.update(todo.id, todo);

    const result = await archiveTodo(
      { todoRepository, logger: mockLogger },
      todo.id,
      'user-1'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(true);
    }
  });

  it('returns INVALID_OPERATION for pending todo', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await archiveTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OPERATION');
    }
  });
});

describe('unarchiveTodo', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('unarchives todo', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const todo = createResult.value;
    todo.status = 'completed';
    todo.archived = true;
    await todoRepository.update(todo.id, todo);

    const result = await unarchiveTodo(
      { todoRepository, logger: mockLogger },
      todo.id,
      'user-1'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(false);
    }
  });
});
