import { Bot, CheckCircle2, MessageCircle, PlayCircle, Wrench } from 'lucide-react';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';
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

function getPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
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
    case 'tool_call_started':
      return `${formatSessionValue(getPayloadString(event.payload, 'toolName'))} started`;
    case 'tool_call_completed':
      return `${formatSessionValue(getPayloadString(event.payload, 'toolName'))} completed`;
    case 'tool_call_failed':
      return `${formatSessionValue(getPayloadString(event.payload, 'toolName'))} failed`;
    case 'unsupported_request':
      return 'Unsupported request';
  }
}

function getEventBody(event: IntexAgentSessionEvent): string {
  const text = getPayloadString(event.payload, 'text');
  if (text !== undefined) return text;

  const message = getPayloadString(event.payload, 'message');
  if (message !== undefined) return message;

  const reason = getPayloadString(event.payload, 'reason');
  const status = getPayloadString(event.payload, 'status');
  const toolName = getPayloadString(event.payload, 'toolName');
  const parts = [
    reason !== undefined ? `Reason: ${formatSessionValue(reason)}` : undefined,
    status !== undefined ? `Status: ${formatSessionValue(status)}` : undefined,
    toolName !== undefined ? `Tool: ${formatSessionValue(toolName)}` : undefined,
    event.payload['explicit'] === true ? 'Explicitly announced to user' : undefined,
  ].filter((part): part is string => part !== undefined);

  if (parts.length > 0) {
    return parts.join(' · ');
  }

  return JSON.stringify(event.payload);
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
            <span>End: {formatSessionValue(session.endReason)}</span>
            <span>Tool: {formatSessionValue(session.activeTool)}</span>
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
          {events.map((event) => (
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
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">
                {getEventBody(event)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
