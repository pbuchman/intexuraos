import type { IntexAgentSessionEventType, IntexAgentSessionStatus } from '@/types';

export function formatSessionValue(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    return 'Unknown';
  }
  return value
    .split(/[_-]/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getSessionStatusClass(status: IntexAgentSessionStatus): string {
  switch (status) {
    case 'active':
    case 'waiting_for_user':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'executing_tool':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300';
    case 'completed':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
    case 'unsupported':
    case 'expired':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
    case 'cancelled':
    case 'superseded':
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export function getSessionEventClass(type: IntexAgentSessionEventType): string {
  switch (type) {
    case 'user_message':
      return 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950';
    case 'assistant_message':
    case 'clarification_requested':
      return 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20';
    case 'tool_call_started':
    case 'tool_call_completed':
      return 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20';
    case 'tool_call_failed':
    case 'unsupported_request':
      return 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20';
    case 'session_started':
    case 'session_closed':
      return 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900';
  }
}
