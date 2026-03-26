import type { SavedNotificationFilter } from '@/types';

/**
 * Active filter state for multi-dimension filtering.
 * App supports multiple selections (OR within dimension), source is single-select.
 */
export interface ActiveFilters {
  app: string[];
  source: string;
  title: string;
}

/**
 * Pill badge for notification metadata.
 */
interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ children, className, title }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={[
        'inline-flex min-w-0 max-w-full items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300',
        className,
      ]
        .filter((value): value is string => value !== undefined && value !== '')
        .join(' ')}
      title={title}
    >
      {children}
    </span>
  );
}

/**
 * Check if active filters have any values set.
 * Also checks titleInput for pending debounced input.
 */
export function hasActiveFilters(filters: ActiveFilters, titleInput?: string): boolean {
  return (
    filters.app.length > 0 ||
    filters.source !== '' ||
    filters.title !== '' ||
    (titleInput !== undefined && titleInput !== '')
  );
}

/**
 * Check if two string arrays have the same values (order-independent).
 */
export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Check if current filters match a saved filter's values.
 */
export function filtersMatchSaved(
  filters: ActiveFilters,
  titleInput: string,
  savedFilter: SavedNotificationFilter
): boolean {
  const savedApp = savedFilter.app ?? [];
  const savedSource = savedFilter.source ?? '';
  const savedTitle = savedFilter.title ?? '';

  return (
    arraysEqual(filters.app, savedApp) &&
    filters.source === savedSource &&
    (filters.title === savedTitle || titleInput === savedTitle)
  );
}
