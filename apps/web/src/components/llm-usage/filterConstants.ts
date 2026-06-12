/**
 * Shared constants for LLM Usage filter UI (desktop and mobile variants).
 * Extracted verbatim from LlmUsagePage.tsx to allow reuse by FilterBar
 * and FilterSheet without circular imports.
 */

import type { UsageEventSortField } from '@/types/llmUsage';
import type { TimeRangePreset, TimeRangeState } from '@/utils/llmUsageTimeRange';

export type GroupByMode =
  | 'none'
  | 'day'
  | 'component'
  | 'service'
  | 'promptType'
  | 'model'
  | 'openrouter-model';

export interface SortState {
  field: UsageEventSortField;
  direction: 'asc' | 'desc';
}

export const PROVIDERS = ['anthropic', 'openai', 'google', 'perplexity', 'openrouter'] as const;

export const PROVIDER_ACTIVE_CLASSES: Record<string, string> = {
  anthropic: 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-900/30 dark:text-orange-400',
  openai: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-400',
  google: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  perplexity: 'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400',
  openrouter: 'border-rose-500 bg-rose-50 text-rose-700 dark:border-rose-400 dark:bg-rose-900/30 dark:text-rose-400',
};

export const INACTIVE_SEGMENT_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

export const PROVIDER_DOT_CLASSES: Record<string, string> = {
  anthropic: 'bg-orange-500',
  openai: 'bg-emerald-500',
  google: 'bg-blue-500',
  perplexity: 'bg-purple-500',
  openrouter: 'bg-rose-500',
};

export const GROUP_BY_MAP: Record<GroupByMode, string[]> = {
  none: [],
  day: ['day'],
  component: ['source.component'],
  service: ['source.service'],
  promptType: ['request.promptType'],
  model: ['request.model'],
  'openrouter-model': ['request.provider', 'request.model'],
};

export const GROUP_BY_OPTIONS: { key: GroupByMode; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'day', label: 'Day' },
  { key: 'component', label: 'Component' },
  { key: 'service', label: 'Service' },
  { key: 'promptType', label: 'Prompt Type' },
  { key: 'model', label: 'Model' },
  { key: 'openrouter-model', label: 'OpenRouter Model' },
];

// "Most expensive" / "Most tokens" sorts are intentionally omitted:
// the composite index `(occurredAt, cost.billedUsd, __name__)` treats the
// secondary field as a tiebreaker, and `occurredAt` is effectively unique
// per event — so the displayed order would be identical to "Newest first".
// A correct ranking requires aggregate-backed queries; tracked as a follow-up.
export const SORT_OPTIONS: { field: UsageEventSortField; direction: 'asc' | 'desc'; label: string }[] = [
  { field: 'occurredAt', direction: 'desc', label: 'Newest first' },
  { field: 'occurredAt', direction: 'asc', label: 'Oldest first' },
];

export const PRESET_OPTIONS: { key: TimeRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7days', label: 'Last 7d' },
  { key: 'last30days', label: 'Last 30d' },
  { key: 'custom', label: 'Custom' },
];

export const DEFAULT_GROUP_BY: GroupByMode = 'none';
export const DEFAULT_SORT: SortState = { field: 'occurredAt', direction: 'desc' };
export const DEFAULT_TIME_RANGE: TimeRangeState = { preset: 'last7days' };
