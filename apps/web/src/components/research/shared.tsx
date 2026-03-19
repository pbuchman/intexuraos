import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { PROVIDER_MODELS } from '@/components';
import type { ResearchStatus } from '@/services/researchAgentApi.types';

// --- Status badge config ---

interface StatusConfig {
  bg: string;
  text: string;
  label: string;
  icon: 'Clock' | 'CheckCircle' | 'XCircle' | 'AlertTriangle' | 'FileText' | 'RefreshCw';
}

export const RESEARCH_STATUS_MAP: Record<ResearchStatus, StatusConfig> = {
  draft:                  { bg: 'bg-amber-100 dark:bg-amber-900/50',   text: 'text-amber-700 dark:text-amber-300',   label: 'Draft',           icon: 'FileText' },
  pending:                { bg: 'bg-slate-100 dark:bg-slate-700',      text: 'text-slate-700 dark:text-slate-300',    label: 'Pending',         icon: 'Clock' },
  processing:             { bg: 'bg-blue-100 dark:bg-blue-900/50',     text: 'text-blue-700 dark:text-blue-300',      label: 'Processing',      icon: 'Clock' },
  awaiting_confirmation:  { bg: 'bg-orange-100 dark:bg-orange-900/50', text: 'text-orange-700 dark:text-orange-300',  label: 'Action Required', icon: 'AlertTriangle' },
  retrying:               { bg: 'bg-blue-100 dark:bg-blue-900/50',     text: 'text-blue-700 dark:text-blue-300',      label: 'Retrying',        icon: 'RefreshCw' },
  synthesizing:           { bg: 'bg-purple-100 dark:bg-purple-900/50', text: 'text-purple-700 dark:text-purple-300',  label: 'Synthesizing',    icon: 'Clock' },
  completed:              { bg: 'bg-green-100 dark:bg-green-900/50',   text: 'text-green-700 dark:text-green-300',    label: 'Completed',       icon: 'CheckCircle' },
  failed:                 { bg: 'bg-red-100 dark:bg-red-900/50',       text: 'text-red-700 dark:text-red-300',        label: 'Failed',          icon: 'XCircle' },
};

const ICON_MAP = { Clock, CheckCircle, XCircle, AlertTriangle, FileText, RefreshCw } as const;

export function ResearchStatusBadge({ status }: { status: ResearchStatus }): React.JSX.Element {
  const config = RESEARCH_STATUS_MAP[status];
  const Icon = ICON_MAP[config.icon];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${config.bg} ${config.text}`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

// --- Filter config (for list page) ---

export type ResearchGroupStatus = 'processing' | 'action-required' | 'completed' | 'failed' | 'draft';

export const ALL_RESEARCH_GROUP_STATUSES: ResearchGroupStatus[] = [
  'processing', 'action-required', 'completed', 'failed', 'draft',
];

export const RESEARCH_GROUP_STATUS_CONFIG: Record<ResearchGroupStatus, { label: string; dotClass: string; activeClass: string }> = {
  processing: {
    label: 'Processing',
    dotClass: 'bg-blue-500',
    activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  },
  'action-required': {
    label: 'Action Required',
    dotClass: 'bg-orange-500',
    activeClass: 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-900/30 dark:text-orange-400',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-green-500',
    activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  },
  failed: {
    label: 'Failed',
    dotClass: 'bg-red-500',
    activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400',
  },
  draft: {
    label: 'Draft',
    dotClass: 'bg-amber-500',
    activeClass: 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400',
  },
};

export const INACTIVE_SEGMENT_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

// --- Sort config ---

export type ResearchSortOption = 'created' | 'completed' | 'favourite';

export const RESEARCH_SORT_OPTIONS: { key: ResearchSortOption; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'completed', label: 'Completed' },
  { key: 'favourite', label: 'Favourites' },
];

// --- Shared helpers used by multiple sub-components ---

/** Resolves a model ID to a human-readable display name using PROVIDER_MODELS. */
export function getModelDisplayName(modelId: string): string {
  for (const provider of PROVIDER_MODELS) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model !== undefined) {
      return model.name;
    }
  }
  return modelId;
}

// --- Filter helpers ---

export function deriveGroupStatus(status: ResearchStatus): ResearchGroupStatus {
  if (status === 'draft') return 'draft';
  if (status === 'pending' || status === 'processing' || status === 'retrying' || status === 'synthesizing') return 'processing';
  if (status === 'awaiting_confirmation') return 'action-required';
  if (status === 'completed') return 'completed';
  return 'failed';
}

export function getAccentShadow(groupStatus: ResearchGroupStatus): string {
  if (groupStatus === 'processing') return 'shadow-[inset_3px_0_0_theme(colors.blue.500)]';
  if (groupStatus === 'action-required') return 'shadow-[inset_3px_0_0_theme(colors.orange.500)]';
  if (groupStatus === 'completed') return 'shadow-[inset_3px_0_0_theme(colors.green.500)]';
  if (groupStatus === 'failed') return 'shadow-[inset_3px_0_0_theme(colors.red.500)]';
  return '';
}
