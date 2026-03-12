import type { CodeTaskStatus, WorkerStatusTag } from '@/types';

// --- Worker types (shared by V2TaskActions + V2NextSteps) ---

export type WorkerType = 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm-5' | 'qwen3.5-plus';

export const WORKER_TYPES: WorkerType[] = ['auto', 'opus', 'sonnet', 'minimax', 'glm-5', 'qwen3.5-plus'];

export const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  auto: 'Auto',
  opus: 'Opus',
  sonnet: 'Sonnet',
  minimax: 'Minimax',
  'glm-5': 'GLM-5',
  'qwen3.5-plus': 'Qwen 3.5 Plus',
};

// --- Status badge config ---

interface StatusConfig {
  bg: string;
  text: string;
  label: string;
  icon: 'Clock' | 'Loader2' | 'CheckCircle2' | 'XCircle' | 'AlertCircle' | 'Archive';
}

export const STATUS_MAP: Record<CodeTaskStatus, StatusConfig> = {
  queued:      { bg: 'bg-amber-100 dark:bg-amber-900/50',     text: 'text-amber-800 dark:text-amber-300',     label: 'Queued',       icon: 'Clock' },
  dispatched:  { bg: 'bg-slate-100 dark:bg-slate-700',        text: 'text-slate-600 dark:text-slate-400',     label: 'Dispatched',   icon: 'Clock' },
  running:     { bg: 'bg-blue-100 dark:bg-blue-900/50',       text: 'text-blue-800 dark:text-blue-300',       label: 'Running',      icon: 'Loader2' },
  planned:     { bg: 'bg-violet-100 dark:bg-violet-900/50',   text: 'text-violet-800 dark:text-violet-300',   label: 'Planned',      icon: 'CheckCircle2' },
  implemented: { bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-800 dark:text-emerald-300', label: 'Implemented',  icon: 'CheckCircle2' },
  reviewed:    { bg: 'bg-teal-100 dark:bg-teal-900/50',      text: 'text-teal-800 dark:text-teal-300',      label: 'Reviewed',     icon: 'CheckCircle2' },
  failed:      { bg: 'bg-red-100 dark:bg-red-900/50',         text: 'text-red-800 dark:text-red-300',         label: 'Failed',       icon: 'XCircle' },
  interrupted: { bg: 'bg-orange-100 dark:bg-orange-900/50',   text: 'text-orange-800 dark:text-orange-300',   label: 'Interrupted',  icon: 'AlertCircle' },
  cancelled:   { bg: 'bg-slate-100 dark:bg-slate-700',        text: 'text-slate-600 dark:text-slate-400',     label: 'Cancelled',    icon: 'XCircle' },
  archived:    { bg: 'bg-slate-100 dark:bg-slate-800',        text: 'text-slate-500 dark:text-slate-500',     label: 'Archived',     icon: 'Archive' },
};

// Icon lookup — import from lucide-react in consuming components:
// import { Clock, Loader2, CheckCircle2, XCircle, AlertCircle, Archive } from 'lucide-react';
// const ICON_MAP = { Clock, Loader2, CheckCircle2, XCircle, AlertCircle, Archive };
// Usage: const Icon = ICON_MAP[status.icon];

export const WORKER_STATUS_STYLES: Record<WorkerStatusTag, string> = {
  healthy:                    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  'orchestrator-unreachable': 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  'tunnel-down':              'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  unknown:                    'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
};

export const LINEAR_STATE_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  started:   'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

export const DEFAULT_STATE_STYLE = 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';

export function isActiveStatus(status: CodeTaskStatus): boolean {
  return status === 'queued' || status === 'dispatched' || status === 'running';
}

// --- Shared link buttons (used by V2TaskActions + V2NextSteps) ---

export function GitHubButton({ href }: { href: string }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
    >
      GitHub
    </a>
  );
}

export function LinearButton({ href }: { href: string }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-600 dark:bg-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-800"
    >
      Linear
    </a>
  );
}
