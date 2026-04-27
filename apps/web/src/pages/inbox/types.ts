import type { Action, ActionStatus, Command } from '@/types';

export type TabId = 'commands' | 'actions';
export type ActionSortKey = 'created' | 'status';
export type CommandSortKey = 'created' | 'type';

export const ACTION_SORT_OPTIONS: { key: ActionSortKey; label: string }[] = [
  { key: 'created', label: 'Newest' },
  { key: 'status', label: 'Status' },
];

export const COMMAND_SORT_OPTIONS: { key: CommandSortKey; label: string }[] = [
  { key: 'created', label: 'Newest' },
  { key: 'type', label: 'Type' },
];

const STATUS_ORDER: Record<ActionStatus, number> = {
  pending: 0,
  awaiting_approval: 1,
  processing: 2,
  completed: 3,
  failed: 4,
  rejected: 5,
  archived: 6,
};

export function getActionsCountByStatus(actions: Action[]): Record<ActionStatus, number> {
  const counts: Record<ActionStatus, number> = {
    pending: 0,
    awaiting_approval: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    archived: 0,
  };
  for (const action of actions) {
    if (action.status in counts) {
      counts[action.status]++;
    }
  }
  return counts;
}

export function sortActions(actions: Action[], sortKey: ActionSortKey): Action[] {
  const sorted = [...actions];
  if (sortKey === 'created') {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  if (sortKey === 'status') {
    sorted.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }
  return sorted;
}

export function sortCommands(commands: Command[], sortKey: CommandSortKey): Command[] {
  const sorted = [...commands];
  if (sortKey === 'created') {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  if (sortKey === 'type') {
    sorted.sort((a, b) => {
      const typeA = a.classification?.type ?? 'unknown';
      const typeB = b.classification?.type ?? 'unknown';
      return typeA.localeCompare(typeB);
    });
  }
  return sorted;
}
