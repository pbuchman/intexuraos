import { Bot, CheckCircle2, MessageCircle, PlayCircle, Wrench } from 'lucide-react';
import type {
  IntexAgentSession,
  IntexAgentSessionEndReason,
  IntexAgentSessionEvent,
  IntexAgentSessionStartReason,
  IntexAgentSessionStatus,
  IntexAgentToolName,
} from '@/types';
import {
  formatSessionDateTimeCompact,
  formatSessionValue,
  getSessionStatusClass,
  getSessionEventClass,
  getSessionTitle,
} from './sessionPresentation.js';

interface IntexSessionTimelineProps {
  session: IntexAgentSession | undefined;
  events: IntexAgentSessionEvent[];
  loading: boolean;
}

type IntexAgentFallbackReason =
  | 'classifier_unsupported'
  | 'runner_declared_unsupported'
  | 'runner_output_malformed'
  | 'tool_result_mismatch'
  | 'llm_call_failed';

type ConfirmationResolution = 'accepted' | 'rejected' | 'superseded';

const SESSION_STATUSES = {
  active: true,
  waiting_for_user: true,
  executing_tool: true,
  completed: true,
  unsupported: true,
  expired: true,
  cancelled: true,
  superseded: true,
} satisfies Record<IntexAgentSessionStatus, true>;

const SESSION_START_REASONS = {
  no_active_session: true,
  previous_completed: true,
  previous_expired: true,
  user_requested_new_session: true,
  previous_superseded: true,
} satisfies Record<IntexAgentSessionStartReason, true>;

const SESSION_END_REASONS = {
  tool_completed: true,
  tool_failed: true,
  unsupported_request: true,
  timeout: true,
  cancelled_by_user: true,
  superseded_by_user: true,
} satisfies Record<IntexAgentSessionEndReason, true>;

const TOOL_NAMES = {
  create_note: true,
  create_calendar_event: true,
  update_calendar_event: true,
  query_calendar_events: true,
  create_research: true,
  create_link: true,
  create_code_task: true,
  save_external: true,
  get_user_preferences: true,
  add_user_preference: true,
  update_user_preference: true,
  delete_user_preference: true,
} satisfies Record<IntexAgentToolName, true>;

const FALLBACK_REASONS = {
  classifier_unsupported: true,
  runner_declared_unsupported: true,
  runner_output_malformed: true,
  tool_result_mismatch: true,
  llm_call_failed: true,
} satisfies Record<IntexAgentFallbackReason, true>;

const CONFIRMATION_RESOLUTIONS = {
  accepted: true,
  rejected: true,
  superseded: true,
} satisfies Record<ConfirmationResolution, true>;

function getCanonicalValue<T extends string>(
  payload: Record<string, unknown>,
  key: string,
  values: Readonly<Record<T, true>>
): T | undefined {
  const value = payload[key];
  if (typeof value !== 'string' || !Object.hasOwn(values, value)) {
    return undefined;
  }
  return value as T;
}

function getDisplayString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const trimmed = value.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      return undefined;
    }
  } catch {
    // Ordinary text is intentionally displayable.
  }

  return value;
}

function getEventTitle(event: IntexAgentSessionEvent): string {
  switch (event.type) {
    case 'session_started':
      return 'Session started';
    case 'session_closed':
      return 'Session closed';
    case 'user_message':
      return 'User';
    case 'assistant_message':
      return 'IntexuraOS';
    case 'clarification_requested':
      return 'Clarification requested';
    case 'agent_fallback':
      return 'Agent fallback';
    case 'confirmation_requested':
      return 'Confirmation requested';
    case 'confirmation_resolved':
      return 'Confirmation resolved';
    case 'tool_call_started': {
      const toolName = getCanonicalValue(event.payload, 'toolName', TOOL_NAMES);
      return toolName === undefined
        ? 'Tool call started'
        : `${formatSessionValue(toolName)} started`;
    }
    case 'tool_call_completed': {
      const toolName = getCanonicalValue(event.payload, 'toolName', TOOL_NAMES);
      return toolName === undefined
        ? 'Tool call completed'
        : `${formatSessionValue(toolName)} completed`;
    }
    case 'tool_call_failed': {
      const toolName = getCanonicalValue(event.payload, 'toolName', TOOL_NAMES);
      return toolName === undefined
        ? 'Tool call failed'
        : `${formatSessionValue(toolName)} failed`;
    }
    case 'unsupported_request':
      return 'Unsupported request';
  }
}

function getEventBody(event: IntexAgentSessionEvent): string | undefined {
  switch (event.type) {
    case 'user_message':
    case 'assistant_message':
      return getDisplayString(event.payload, 'text');
    case 'clarification_requested':
    case 'confirmation_requested':
    case 'unsupported_request':
      return (
        getDisplayString(event.payload, 'message') ?? getDisplayString(event.payload, 'text')
      );
    case 'session_started': {
      const reason = getCanonicalValue(event.payload, 'reason', SESSION_START_REASONS);
      const parts = [
        reason !== undefined ? `Reason: ${formatSessionValue(reason)}` : undefined,
        event.payload['explicit'] === true ? 'Explicitly announced to user' : undefined,
      ].filter((part): part is string => part !== undefined);
      return parts.length === 0 ? undefined : parts.join(' · ');
    }
    case 'session_closed': {
      const reason = getCanonicalValue(event.payload, 'reason', SESSION_END_REASONS);
      const status = getCanonicalValue(event.payload, 'status', SESSION_STATUSES);
      const parts = [
        reason !== undefined ? `Reason: ${formatSessionValue(reason)}` : undefined,
        status !== undefined ? `Status: ${formatSessionValue(status)}` : undefined,
      ].filter((part): part is string => part !== undefined);
      return parts.length === 0 ? undefined : parts.join(' · ');
    }
    case 'tool_call_started':
    case 'tool_call_completed':
    case 'tool_call_failed': {
      const toolName = getCanonicalValue(event.payload, 'toolName', TOOL_NAMES);
      return toolName === undefined ? undefined : `Tool: ${formatSessionValue(toolName)}`;
    }
    case 'confirmation_resolved': {
      const resolution = getCanonicalValue(
        event.payload,
        'resolution',
        CONFIRMATION_RESOLUTIONS
      );
      return resolution === undefined
        ? undefined
        : `Resolution: ${formatSessionValue(resolution)}`;
    }
    case 'agent_fallback': {
      const reason = getCanonicalValue(event.payload, 'reason', FALLBACK_REASONS);
      return reason === undefined ? undefined : `Reason: ${formatSessionValue(reason)}`;
    }
  }
}

function EventIcon({ event }: { event: IntexAgentSessionEvent }): React.JSX.Element {
  if (event.type === 'user_message') return <MessageCircle className="h-4 w-4" />;
  if (event.type === 'assistant_message' || event.type === 'clarification_requested') {
    return <Bot className="h-4 w-4" />;
  }
  if (event.type === 'agent_fallback') return <Bot className="h-4 w-4" />;
  if (event.type.startsWith('tool_call')) return <Wrench className="h-4 w-4" />;
  if (event.type === 'session_closed') return <CheckCircle2 className="h-4 w-4" />;
  return <PlayCircle className="h-4 w-4" />;
}

export function IntexSessionTimeline({
  session,
  events,
  loading,
}: IntexSessionTimelineProps): React.JSX.Element {
  return (
    <section
      data-testid="intex-agent-session-timeline"
      className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="sticky top-16 z-10 border-b border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-slate-400" />
              <h3 className="truncate text-lg font-semibold text-slate-950 dark:text-slate-50">
                {session === undefined ? 'Select a session' : getSessionTitle(session)}
              </h3>
            </div>
            {session !== undefined ? (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Started {formatSessionDateTimeCompact(session.startedAt)}
                {session.endedAt !== undefined
                  ? ` · Ended ${formatSessionDateTimeCompact(session.endedAt)}`
                  : ''}
              </p>
            ) : null}
          </div>
          {session !== undefined ? (
            <span
              className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${getSessionStatusClass(
                session.status
              )}`}
            >
              {formatSessionValue(session.status)}
            </span>
          ) : null}
        </div>

        {session !== undefined ? (
          <div className="mt-4 grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-2 xl:grid-cols-4">
            <span>Start: {formatSessionValue(session.startReason)}</span>
            <span>
              End:{' '}
              {session.endReason === undefined ? 'Open' : formatSessionValue(session.endReason)}
            </span>
            <span>
              Tool:{' '}
              {session.activeTool === undefined ? 'None' : formatSessionValue(session.activeTool)}
            </span>
            <span>
              Assistant:{' '}
              {session.lastAssistantMessageAt !== undefined
                ? formatSessionDateTimeCompact(session.lastAssistantMessageAt)
                : 'No reply yet'}
            </span>
          </div>
        ) : null}
      </div>

      <div className="min-h-[28rem] p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : null}

        {!loading && session === undefined ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bot className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Select a session to inspect its timeline.
            </p>
          </div>
        ) : null}

        {!loading && session !== undefined && events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageCircle className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              No events recorded for this session.
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          {events.map((event) => {
            const body = getEventBody(event);
            return (
              <article
                key={event.id}
                className={`rounded-lg border px-4 py-3 ${getSessionEventClass(event.type)}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">
                    <EventIcon event={event} />
                  </span>
                  <span className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                    {getEventTitle(event)}
                  </span>
                  <time
                    dateTime={event.createdAt}
                    className="text-xs font-medium text-slate-500 dark:text-slate-400"
                  >
                    {formatSessionDateTimeCompact(event.createdAt)}
                  </time>
                </div>
                {body !== undefined ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">
                    {body}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
