import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
  IntexAgentSessionStatus,
} from '@/types';
import { formatDateTimeCompact, formatRelative } from '@/utils/dateFormat';

const EVENT_TYPE_ORDER: Record<IntexAgentSessionEventType, number> = {
  session_started: 0,
  user_message: 10,
  confirmation_requested: 20,
  confirmation_resolved: 20,
  tool_call_started: 20,
  tool_call_completed: 30,
  tool_call_failed: 30,
  agent_fallback: 39,
  unsupported_request: 40,
  clarification_requested: 40,
  assistant_message: 50,
  session_closed: 90,
};

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

export function parseSessionTimestamp(value: string): Date | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const epoch = Number(trimmed);
    if (Number.isSafeInteger(epoch)) {
      const millis = trimmed.length <= 10 ? epoch * 1000 : epoch;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatSessionDateTimeCompact(value: string): string {
  const date = parseSessionTimestamp(value);
  return date === undefined ? 'Unknown' : formatDateTimeCompact(date.toISOString());
}

export function formatSessionRelative(value: string): string {
  const date = parseSessionTimestamp(value);
  return date === undefined ? 'Unknown' : formatRelative(date.toISOString());
}

export function getSessionTitle(session: IntexAgentSession): string {
  if (session.summary !== undefined && session.summary.trim() !== '') {
    return session.summary;
  }
  if (session.activeTool !== undefined) {
    return formatSessionValue(session.activeTool);
  }
  if (session.endReason !== undefined) {
    return formatSessionValue(session.endReason);
  }
  return formatSessionValue(session.status);
}

export function sortSessionEventsForTimeline(
  events: IntexAgentSessionEvent[]
): IntexAgentSessionEvent[] {
  return [...events].sort(compareSessionEvents);
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
    case 'confirmation_requested':
    case 'confirmation_resolved':
      return 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20';
    case 'tool_call_started':
    case 'tool_call_completed':
      return 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20';
    case 'tool_call_failed':
    case 'agent_fallback':
    case 'unsupported_request':
      return 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20';
    case 'session_started':
    case 'session_closed':
      return 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900';
  }
}

function compareSessionEvents(a: IntexAgentSessionEvent, b: IntexAgentSessionEvent): number {
  const aTime = parseSessionTimestamp(a.createdAt)?.getTime() ?? 0;
  const bTime = parseSessionTimestamp(b.createdAt)?.getTime() ?? 0;
  const timeDiff = aTime - bTime;
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const typeDiff = EVENT_TYPE_ORDER[a.type] - EVENT_TYPE_ORDER[b.type];
  if (typeDiff !== 0) {
    return typeDiff;
  }

  return a.id.localeCompare(b.id);
}
