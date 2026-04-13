import type { PruneCandidateResponse } from '@/services/linearApi';

// --- Category config (analogous to GROUP_STATUS_CONFIG in CodeTasksPage) ---

export type PruneCategory = PruneCandidateResponse['category'];

export const ALL_CATEGORIES: PruneCategory[] = [
  'cancelled',
  'duplicate',
  'sub-issue',
  'simple-fix',
  'review-only',
  'other',
];

export interface CategoryConfig {
  label: string;
  dotClass: string;
  activeClass: string;
  badgeClass: string;
}

export const CATEGORY_CONFIG: Record<PruneCategory, CategoryConfig> = {
  cancelled: {
    label: 'Cancelled',
    dotClass: 'bg-slate-400',
    activeClass:
      'border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300',
    badgeClass:
      'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  },
  duplicate: {
    label: 'Duplicate',
    dotClass: 'bg-purple-500',
    activeClass:
      'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400',
    badgeClass:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  },
  'sub-issue': {
    label: 'Sub-issue',
    dotClass: 'bg-blue-500',
    activeClass:
      'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
    badgeClass:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  },
  'simple-fix': {
    label: 'Simple Fix',
    dotClass: 'bg-green-500',
    activeClass:
      'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
    badgeClass:
      'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  },
  'review-only': {
    label: 'Review Only',
    dotClass: 'bg-amber-500',
    activeClass:
      'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400',
    badgeClass:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  },
  other: {
    label: 'Other',
    dotClass: 'bg-slate-400',
    activeClass:
      'border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300',
    badgeClass:
      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
  },
};

export const INACTIVE_PILL_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

// --- Sort options (analogous to SORT_OPTIONS in CodeTasksPage) ---

export type PruneSortOption = 'score' | 'category' | 'identifier';

export const SORT_OPTIONS: { key: PruneSortOption; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'category', label: 'Category' },
  { key: 'identifier', label: 'Issue ID' },
];

// --- LocalStorage keys ---

export const FILTER_STORAGE_KEY = 'prune-candidates-category-filter';
export const SORT_STORAGE_KEY = 'prune-candidates-sort';

// --- Score color helper ---

export function scoreColor(score: number): string {
  if (score >= 80) return 'text-red-600 dark:text-red-400';
  if (score >= 60) return 'text-orange-600 dark:text-orange-400';
  return 'text-yellow-600 dark:text-yellow-400';
}
