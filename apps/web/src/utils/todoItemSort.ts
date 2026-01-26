import type { TodoItem, TodoPriority } from '@/types';

type PriorityKey = TodoPriority | 'null';

/**
 * Priority order for sorting (highest to lowest).
 * Items with no priority (null) sort last within their completion group.
 */
const PRIORITY_ORDER: Readonly<Record<PriorityKey, number>> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  null: 0,
} as const;

/**
 * Get the numeric priority score for a todo item.
 */
function getPriorityScore(item: TodoItem): number {
  return PRIORITY_ORDER[item.priority ?? 'null'];
}

/**
 * Compare two todo items for sorting.
 *
 * Sort key (in order of precedence):
 * 1. Pending first - uncompleted items above completed
 * 2. Priority descending - urgent > high > medium > low > none
 * 3. Original position - maintain insertion order within same priority
 */
function compareTodoItems(a: TodoItem, b: TodoItem): number {
  // Primary: completed items go to the bottom
  const aCompleted = a.status === 'completed';
  const bCompleted = b.status === 'completed';

  if (aCompleted !== bCompleted) {
    return aCompleted ? 1 : -1;
  }

  // Secondary: priority descending (higher priority first)
  const aPriorityScore = getPriorityScore(a);
  const bPriorityScore = getPriorityScore(b);

  if (aPriorityScore !== bPriorityScore) {
    return bPriorityScore - aPriorityScore;
  }

  // Tertiary: original position (ascending)
  return a.position - b.position;
}

/**
 * Sort todo items with the proper sort key:
 * 1. Pending first (uncompleted above completed)
 * 2. Priority descending (urgent > high > medium > low > none)
 * 3. Original position within same priority
 *
 * @param items - Todo items to sort
 * @returns New array with sorted items
 */
export function sortTodoItems<T extends TodoItem>(items: readonly T[]): T[] {
  return [...items].sort(compareTodoItems);
}
