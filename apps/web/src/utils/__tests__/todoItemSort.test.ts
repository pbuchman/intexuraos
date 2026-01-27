import { describe, expect, it } from 'vitest';
import { sortTodoItems } from '../todoItemSort.js';
import type { TodoItem } from '@/types';

function createMockItem(overrides: Partial<TodoItem> & { id: string }): TodoItem {
  return {
    id: overrides.id,
    title: overrides.title ?? 'Test Item',
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? null,
    dueDate: overrides.dueDate ?? null,
    position: overrides.position ?? 0,
    completedAt: overrides.completedAt ?? null,
    todoId: 'test-todo-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('sortTodoItems', () => {
  it('sorts pending items before completed items', () => {
    const items = [
      createMockItem({ id: '1', status: 'completed', position: 1 }),
      createMockItem({ id: '2', status: 'pending', position: 2 }),
      createMockItem({ id: '3', status: 'completed', position: 3 }),
      createMockItem({ id: '4', status: 'pending', position: 4 }),
    ];

    const result = sortTodoItems(items);

    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('4');
    expect(result[2].id).toBe('1');
    expect(result[3].id).toBe('3');
  });

  it('sorts by priority descending within each completion group', () => {
    const items = [
      createMockItem({ id: '1', status: 'pending', priority: 'medium', position: 1 }),
      createMockItem({ id: '2', status: 'pending', priority: 'high', position: 2 }),
      createMockItem({ id: '3', status: 'pending', priority: 'low', position: 3 }),
      createMockItem({ id: '4', status: 'pending', priority: null, position: 4 }),
    ];

    const result = sortTodoItems(items);

    // Unprioritized items sort between medium and low
    expect(result[0].id).toBe('2'); // high
    expect(result[1].id).toBe('1'); // medium
    expect(result[2].id).toBe('4'); // none (between medium and low)
    expect(result[3].id).toBe('3'); // low
  });

  it('places urgent priority above high', () => {
    const items = [
      createMockItem({ id: '1', status: 'pending', priority: 'urgent', position: 1 }),
      createMockItem({ id: '2', status: 'pending', priority: 'high', position: 2 }),
      createMockItem({ id: '3', status: 'pending', priority: 'urgent', position: 3 }),
    ];

    const result = sortTodoItems(items);

    expect(result[0].id).toBe('1'); // urgent, position 1
    expect(result[1].id).toBe('3'); // urgent, position 3
    expect(result[2].id).toBe('2'); // high
  });

  it('places unprioritized items between medium and low priority', () => {
    const items = [
      createMockItem({ id: '1', status: 'pending', priority: 'low', position: 1 }),
      createMockItem({ id: '2', status: 'pending', priority: null, position: 2 }),
      createMockItem({ id: '3', status: 'pending', priority: 'medium', position: 3 }),
      createMockItem({ id: '4', status: 'pending', priority: null, position: 4 }),
    ];

    const result = sortTodoItems(items);

    expect(result[0].id).toBe('3'); // medium
    expect(result[1].id).toBe('2'); // none (between medium and low, position 2)
    expect(result[2].id).toBe('4'); // none (between medium and low, position 4)
    expect(result[3].id).toBe('1'); // low
  });

  it('maintains original position order within same priority and status', () => {
    const items = [
      createMockItem({ id: '1', status: 'pending', priority: 'high', position: 3 }),
      createMockItem({ id: '2', status: 'pending', priority: 'high', position: 1 }),
      createMockItem({ id: '3', status: 'pending', priority: 'high', position: 2 }),
    ];

    const result = sortTodoItems(items);

    expect(result[0].id).toBe('2'); // position 1
    expect(result[1].id).toBe('3'); // position 2
    expect(result[2].id).toBe('1'); // position 3
  });

  it('sorts completed items by priority too', () => {
    const items = [
      createMockItem({ id: '1', status: 'completed', priority: 'low', position: 1 }),
      createMockItem({ id: '2', status: 'completed', priority: 'high', position: 2 }),
      createMockItem({ id: '3', status: 'pending', priority: 'low', position: 3 }),
    ];

    const result = sortTodoItems(items);

    expect(result[0].id).toBe('3'); // pending low
    expect(result[1].id).toBe('2'); // completed high
    expect(result[2].id).toBe('1'); // completed low
  });

  it('handles mixed status and priority correctly', () => {
    const items = [
      createMockItem({ id: '1', status: 'completed', priority: 'high', position: 1 }),
      createMockItem({ id: '2', status: 'pending', priority: 'low', position: 2 }),
      createMockItem({ id: '3', status: 'pending', priority: 'high', position: 3 }),
      createMockItem({ id: '4', status: 'completed', priority: 'medium', position: 4 }),
      createMockItem({ id: '5', status: 'pending', priority: null, position: 5 }),
    ];

    const result = sortTodoItems(items);

    // Pending group first, ordered by priority: high > none > low
    expect(result[0].id).toBe('3'); // pending high
    expect(result[1].id).toBe('5'); // pending none (between medium and low)
    expect(result[2].id).toBe('2'); // pending low

    // Completed group after, ordered by priority: high > medium
    expect(result[3].id).toBe('1'); // completed high
    expect(result[4].id).toBe('4'); // completed medium
  });

  it('returns empty array for empty input', () => {
    const result = sortTodoItems([]);
    expect(result).toEqual([]);
  });

  it('returns single item for single item input', () => {
    const items = [createMockItem({ id: '1', status: 'pending', priority: 'high', position: 1 })];
    const result = sortTodoItems(items);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('does not mutate the original array', () => {
    const items = [
      createMockItem({ id: '1', status: 'completed', position: 1 }),
      createMockItem({ id: '2', status: 'pending', position: 2 }),
    ];

    const originalOrder = items.map((i) => i.id);
    sortTodoItems(items);

    expect(items.map((i) => i.id)).toEqual(originalOrder);
  });
});
