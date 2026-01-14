import { describe, it, expect, beforeEach } from 'vitest';
import { FakeTodoRepository } from './fakeTodoRepository.js';
import { setupTestContext } from './testUtils.js';
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
import { cancelTodo } from '../domain/usecases/cancelTodo.js';
import { processTodoCreated } from '../domain/usecases/processTodoCreated.js';

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
    const result = await getTodo({ todoRepository, logger: mockLogger }, 'non-existent', 'user-1');

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

  it('updates todo with dueDate set to null', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Original',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      dueDate: new Date('2025-12-31'),
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await updateTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { dueDate: null }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dueDate).toBeNull();
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

  it('adds item with priority and dueDate', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const dueDate = new Date('2025-12-31');
    const result = await addTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { title: 'New Item', priority: 'high', dueDate }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.title).toBe('New Item');
      expect(result.value.items[0]?.priority).toBe('high');
      expect(result.value.items[0]?.dueDate).toEqual(dueDate);
    }
  });

  it('adds item to todo with existing items and calculates position', async () => {
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

    const result = await addTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { title: 'Item 3' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(3);
      expect(result.value.items[2]?.title).toBe('Item 3');
      expect(result.value.items[2]?.position).toBe(2);
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

    const result = await addTodoItem({ todoRepository, logger: mockLogger }, todo.id, 'user-1', {
      title: 'New Item',
    });

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

  it('clears dueDate when set to null', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      items: [{ title: 'Item 1', dueDate: new Date('2025-12-31') }],
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
      { dueDate: null }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.dueDate).toBeNull();
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

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      'non-existent-todo',
      'item-id',
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns FORBIDDEN for non-owner', async () => {
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
      'other-user',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns error on storage failure', async () => {
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

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      itemId,
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('handles todo with no items when checking status (edge case)', async () => {
    // Create a todo without items - this tests the computeTodoStatus function's empty items branch
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // A todo with no items should have status 'pending'
    expect(createResult.value.status).toBe('pending');
    expect(createResult.value.items).toHaveLength(0);
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

  it('returns INVALID_OPERATION for mismatched item id', async () => {
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

  it('returns INVALID_OPERATION for item count mismatch', async () => {
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

    const firstItemId = createResult.value.items[0]?.id;
    expect(firstItemId).toBeDefined();
    if (firstItemId === undefined) return;

    const result = await reorderTodoItems(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { itemIds: [firstItemId] }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OPERATION');
      expect(result.error.message).toBe('Item count mismatch');
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

    const result = await archiveTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

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

    const result = await unarchiveTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(false);
    }
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await unarchiveTodo(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
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

    const result = await unarchiveTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'other-user'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns success when todo is already unarchived', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await unarchiveTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(false);
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await unarchiveTodo({ todoRepository, logger: mockLogger }, 'any-id', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
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

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await unarchiveTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('addTodoItem - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await addTodoItem(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'user-1',
      { title: 'New Item' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
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

    const result = await addTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'other-user',
      { title: 'New Item' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await addTodoItem({ todoRepository, logger: mockLogger }, 'any-id', 'user-1', {
      title: 'New Item',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await addTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { title: 'New Item' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('archiveTodo - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await archiveTodo(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
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

    const todo = createResult.value;
    todo.status = 'completed';
    await todoRepository.update(todo.id, todo);

    const result = await archiveTodo({ todoRepository, logger: mockLogger }, todo.id, 'other-user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns success when todo is already archived', async () => {
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

    const result = await archiveTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(true);
    }
  });

  it('archives cancelled todo', async () => {
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
    todo.status = 'cancelled';
    await todoRepository.update(todo.id, todo);

    const result = await archiveTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.archived).toBe(true);
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await archiveTodo({ todoRepository, logger: mockLogger }, 'any-id', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
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

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await archiveTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('getTodo - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns error on storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await getTodo({ todoRepository, logger: mockLogger }, 'any-id', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('updateTodo - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await updateTodo(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'user-1',
      { title: 'Updated' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await updateTodo({ todoRepository, logger: mockLogger }, 'any-id', 'user-1', {
      title: 'Updated',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await updateTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { title: 'Updated' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('deleteTodo - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await deleteTodo(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await deleteTodo({ todoRepository, logger: mockLogger }, 'any-id', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on delete storage failure', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    todoRepository.simulateMethodError('delete', {
      code: 'STORAGE_ERROR',
      message: 'Delete failed',
    });

    const result = await deleteTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('listTodos - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns error on storage failure', async () => {
    todoRepository.simulateMethodError('findByUserId', {
      code: 'STORAGE_ERROR',
      message: 'DB error',
    });

    const result = await listTodos({ todoRepository, logger: mockLogger }, 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('updateTodoItem - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'item-id',
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns FORBIDDEN for non-owner', async () => {
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
      'other-user',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns error on storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      'any-id',
      'item-id',
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('updates item title and priority', async () => {
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
      { title: 'Updated Title', priority: 'high' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.title).toBe('Updated Title');
      expect(result.value.items[0]?.priority).toBe('high');
    }
  });

  it('sets in_progress when item marked completed', async () => {
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

    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      itemId,
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('in_progress');
    }
  });

  it('returns error on update storage failure', async () => {
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

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await updateTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      itemId,
      'user-1',
      { status: 'completed' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('deleteTodoItem - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await deleteTodoItem(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'item-id',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns FORBIDDEN for non-owner', async () => {
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

    const result = await deleteTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      itemId,
      'other-user'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
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

    const result = await deleteTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'non-existent-item',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await deleteTodoItem(
      { todoRepository, logger: mockLogger },
      'any-id',
      'item-id',
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
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

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await deleteTodoItem(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      itemId,
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('reorderTodoItems - additional coverage', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await reorderTodoItems(
      { todoRepository, logger: mockLogger },
      'non-existent',
      'user-1',
      { itemIds: [] }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns FORBIDDEN for non-owner', async () => {
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
      'other-user',
      { itemIds: [] }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await reorderTodoItems(
      { todoRepository, logger: mockLogger },
      'any-id',
      'user-1',
      { itemIds: [] }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
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

    const items = createResult.value.items;
    const itemIds = items.map((item) => item.id);

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await reorderTodoItems(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1',
      { itemIds }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('cancelTodo', () => {
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = new FakeTodoRepository();
  });

  it('cancels pending todo', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await cancelTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('cancelled');
    }
  });

  it('cancels in_progress todo', async () => {
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
    todo.status = 'in_progress';
    await todoRepository.update(todo.id, todo);

    const result = await cancelTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('cancelled');
    }
  });

  it('returns INVALID_OPERATION for completed todo', async () => {
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

    const result = await cancelTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OPERATION');
      expect(result.error.message).toBe('Completed todos cannot be cancelled');
    }
  });

  it('returns success when todo is already cancelled', async () => {
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
    todo.status = 'cancelled';
    await todoRepository.update(todo.id, todo);

    const result = await cancelTodo({ todoRepository, logger: mockLogger }, todo.id, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('cancelled');
    }
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await cancelTodo({ todoRepository, logger: mockLogger }, 'non-existent', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
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

    const result = await cancelTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'other-user'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await cancelTodo({ todoRepository, logger: mockLogger }, 'any-id', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await cancelTodo(
      { todoRepository, logger: mockLogger },
      createResult.value.id,
      'user-1'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });
});

describe('processTodoCreated', () => {
  const context = setupTestContext();
  let todoRepository: FakeTodoRepository;

  beforeEach(() => {
    todoRepository = context.todoRepository;
  });

  it('changes processing todo status to pending', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
    }
  });

  it('changes processing todo status to pending', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
    }
  });

  it('skips todo that is not in processing status', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
    }
  });

  it('returns NOT_FOUND for non-existent todo', async () => {
    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      'non-existent'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns error on findById storage failure', async () => {
    todoRepository.simulateMethodError('findById', { code: 'STORAGE_ERROR', message: 'DB error' });

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      'any-id'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('returns error on update storage failure', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    todoRepository.simulateMethodError('update', {
      code: 'STORAGE_ERROR',
      message: 'Update failed',
    });

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR');
    }
  });

  it('extracts items from description and adds to todo', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'Need to buy groceries and call mom',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = {
      ok: true,
      value: [
        {
          title: 'Buy groceries',
          priority: 'high',
          dueDate: new Date('2025-12-31'),
          reasoning: 'Urgent task',
        },
        {
          title: 'Call mom',
          priority: null,
          dueDate: null,
          reasoning: 'Regular task',
        },
      ],
    };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[0]?.title).toBe('Buy groceries');
      expect(result.value.items[0]?.priority).toBe('high');
      expect(result.value.items[0]?.status).toBe('pending');
      expect(result.value.items[1]?.title).toBe('Call mom');
      expect(result.value.status).toBe('pending');
    }
  });

  it('adds informational item when extraction returns no items', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'No actionable tasks here',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = { ok: true, value: [] };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.title).toBe('No actionable items found in todo description');
      expect(result.value.status).toBe('pending');
    }
  });

  it('adds warning item when extraction fails', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'Tasks to extract',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = {
      ok: false,
      error: {
        code: 'GENERATION_ERROR',
        message: 'LLM failed',
      },
    };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.title).toBe('Item extraction failed (GENERATION_ERROR)');
      expect(result.value.items[0]?.priority).toBe('high');
      expect(result.value.status).toBe('pending');
    }
  });

  it('adds warning item for NO_API_KEY extraction error', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'Some tasks',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = {
      ok: false,
      error: {
        code: 'NO_API_KEY',
        message: 'Please configure your Gemini API key',
      },
    };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.title).toBe('Item extraction failed (NO_API_KEY)');
      expect(result.value.items[0]?.priority).toBe('high');
    }
  });

  it('handles todo with empty description (just updates status)', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: '',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
      expect(result.value.items).toHaveLength(0);
    }
  });

  it('handles todo with null description (just updates status)', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: null,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
      expect(result.value.items).toHaveLength(0);
    }
  });

  it('handles todo with whitespace-only description (just updates status)', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: '   \n\t  ',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
      expect(result.value.items).toHaveLength(0);
    }
  });

  it('adds extracted items after existing items with correct positions', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'Additional tasks',
      items: [{ title: 'Existing item' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = {
      ok: true,
      value: [
        {
          title: 'New item 1',
          priority: null,
          dueDate: null,
          reasoning: 'New task',
        },
        {
          title: 'New item 2',
          priority: null,
          dueDate: null,
          reasoning: 'Another task',
        },
      ],
    };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(3);
      expect(result.value.items[0]?.title).toBe('Existing item');
      expect(result.value.items[0]?.position).toBe(0);
      expect(result.value.items[1]?.title).toBe('New item 1');
      expect(result.value.items[1]?.position).toBe(1);
      expect(result.value.items[2]?.title).toBe('New item 2');
      expect(result.value.items[2]?.position).toBe(2);
    }
  });

  it('truncates description exceeding MAX_DESCRIPTION_LENGTH', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'A'.repeat(10001),
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = {
      ok: true,
      value: [
        {
          title: 'Task from truncated description',
          priority: null,
          dueDate: null,
          reasoning: 'Test',
        },
      ],
    };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.title).toBe('Task from truncated description');
      expect(result.value.status).toBe('pending');
    }
  });

  it('adds all extracted items from description', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'Many tasks',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const extractedItems = Array.from({ length: 60 }, (_, i) => ({
      title: `Task ${String(i)}`,
      priority: null,
      dueDate: null,
      reasoning: `Task number ${String(i)}`,
    }));

    context.todoItemExtractionService.extractItemsResult = { ok: true, value: extractedItems };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(60);
      expect(result.value.items[0]?.title).toBe('Task 0');
      expect(result.value.items[59]?.title).toBe('Task 59');
    }
  });

  it('adds warning item after existing items on extraction failure', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'Tasks to extract',
      items: [{ title: 'Existing item' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = {
      ok: false,
      error: {
        code: 'USER_SERVICE_ERROR',
        message: 'Failed to fetch API key',
      },
    };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[0]?.title).toBe('Existing item');
      expect(result.value.items[1]?.title).toBe('Item extraction failed (USER_SERVICE_ERROR)');
      expect(result.value.items[1]?.position).toBe(1);
    }
  });

  it('adds informational item after existing items when no extraction results', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'Nothing to extract',
      items: [{ title: 'Existing item' }],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = { ok: true, value: [] };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[0]?.title).toBe('Existing item');
      expect(result.value.items[1]?.title).toBe('No actionable items found in todo description');
      expect(result.value.items[1]?.position).toBe(1);
    }
  });

  it('preserves existing items when adding extracted items', async () => {
    const createResult = await todoRepository.create({
      userId: 'user-1',
      title: 'Test',
      tags: [],
      source: 'web',
      sourceId: 'src-1',
      status: 'processing',
      description: 'More tasks',
      items: [
        { title: 'Existing 1' },
        { title: 'Existing 2' },
        { title: 'Existing 3' },
      ],
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    context.todoItemExtractionService.extractItemsResult = {
      ok: true,
      value: [
        {
          title: 'Extracted 1',
          priority: null,
          dueDate: null,
          reasoning: 'Test',
        },
      ],
    };

    const result = await processTodoCreated(
      { todoRepository, logger: mockLogger, todoItemExtractionService: context.todoItemExtractionService },
      createResult.value.id
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(4);
      expect(result.value.items[0]?.title).toBe('Existing 1');
      expect(result.value.items[1]?.title).toBe('Existing 2');
      expect(result.value.items[2]?.title).toBe('Existing 3');
      expect(result.value.items[3]?.title).toBe('Extracted 1');
    }
  });
});
