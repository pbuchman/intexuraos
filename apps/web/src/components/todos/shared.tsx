import { CheckSquare, Circle, Square, X } from 'lucide-react';
import type { TodoPriority, TodoStatus } from '@/types';

export const PRIORITY_CONFIG: Record<TodoPriority, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  medium: { label: 'Medium', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  high: { label: 'High', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' },
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
};

export const STATUS_CONFIG: Record<TodoStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  processing: { label: 'Processing', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' },
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
};

export function PriorityBadge({ priority }: { priority: TodoPriority }): React.JSX.Element {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: TodoStatus }): React.JSX.Element {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

export function ItemStatusIcon({ status }: { status: TodoStatus }): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckSquare className="h-4 w-4 text-green-600 dark:text-green-400" />;
    case 'in_progress':
      return <Circle className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
    case 'cancelled':
      return <X className="h-4 w-4 text-red-600 dark:text-red-400" />;
    default:
      return <Square className="h-4 w-4 text-slate-400 dark:text-slate-500" />;
  }
}

// Filter config
export const TODO_GROUP_STATUSES: TodoStatus[] = ['in_progress', 'processing', 'pending', 'completed', 'cancelled', 'draft'];

export const TODO_FILTER_CONFIG: Record<TodoStatus, { label: string; dotClass: string; activeClass: string }> = {
  in_progress: { label: 'In Progress', dotClass: 'bg-blue-500',   activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400' },
  processing:  { label: 'Processing',  dotClass: 'bg-purple-500', activeClass: 'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400' },
  pending:     { label: 'Pending',     dotClass: 'bg-amber-500',  activeClass: 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400' },
  completed:   { label: 'Completed',   dotClass: 'bg-green-500',  activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400' },
  cancelled:   { label: 'Cancelled',   dotClass: 'bg-red-500',    activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400' },
  draft:       { label: 'Draft',       dotClass: 'bg-slate-400',  activeClass: 'border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

const ACCENT_SHADOW: Partial<Record<TodoStatus, string>> = {
  in_progress: 'shadow-[inset_3px_0_0_theme(colors.blue.500)]',
  pending: 'shadow-[inset_3px_0_0_theme(colors.amber.500)]',
  completed: 'shadow-[inset_3px_0_0_theme(colors.green.500)]',
  cancelled: 'shadow-[inset_3px_0_0_theme(colors.red.500)]',
};

export function getAccentShadow(status: TodoStatus): string {
  return ACCENT_SHADOW[status] ?? '';
}

// Sort config
export type TodoSortOption = 'created' | 'priority' | 'updated';
export const TODO_SORT_OPTIONS: { key: TodoSortOption; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'priority', label: 'Priority' },
  { key: 'updated', label: 'Updated' },
];
