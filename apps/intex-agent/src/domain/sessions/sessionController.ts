import { detectSessionCommand } from '../messages/sessionCommands.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEndReason,
  IntexAgentSessionStartReason,
  IntexAgentSessionStatus,
} from './types.js';
import { getSessionTimestampMs } from './sessionTimestamps.js';

export interface SessionTransitionInput {
  currentSession: IntexAgentSession | null;
  now: string;
  userMessageText: string;
  sessionTimeoutMs: number;
}

interface PriorSessionSummary {
  id: string;
  status: IntexAgentSessionStatus;
  endReason?: IntexAgentSessionEndReason;
}

interface CloseCurrentSession {
  id: string;
  status: 'expired' | 'superseded';
  endReason: 'timeout' | 'superseded_by_user';
  endedAt: string;
}

export type SessionTransitionDecision =
  | {
      action: 'continue';
      effectiveUserMessageText: string;
      session: IntexAgentSession;
    }
  | {
      action: 'start_new';
      effectiveUserMessageText: string | null;
      isExplicitNewSession: boolean;
      startReason: IntexAgentSessionStartReason;
      previousSession?: PriorSessionSummary;
      closeCurrentSession?: CloseCurrentSession;
    };

const TERMINAL_STATUSES = new Set<IntexAgentSessionStatus>([
  'completed',
  'unsupported',
  'expired',
  'cancelled',
  'superseded',
]);

export function decideSessionTransition(input: SessionTransitionInput): SessionTransitionDecision {
  const sessionCommand = detectSessionCommand(input.userMessageText);
  const isExplicitNewSession = sessionCommand.kind === 'start_new';
  const effectiveUserMessageText =
    sessionCommand.kind === 'start_new' ? sessionCommand.requestText : input.userMessageText;

  if (isExplicitNewSession) {
    return {
      action: 'start_new',
      effectiveUserMessageText,
      isExplicitNewSession: true,
      startReason: 'user_requested_new_session',
      ...(input.currentSession !== null && !isTerminal(input.currentSession)
        ? { closeCurrentSession: closeSession(input.currentSession, 'superseded', input.now) }
        : {}),
    };
  }

  if (input.currentSession === null) {
    return {
      action: 'start_new',
      effectiveUserMessageText,
      isExplicitNewSession: false,
      startReason: 'no_active_session',
    };
  }

  if (isTerminal(input.currentSession)) {
    return {
      action: 'start_new',
      effectiveUserMessageText,
      isExplicitNewSession: false,
      startReason: startReasonAfterTerminal(input.currentSession),
      previousSession: summarizePriorSession(input.currentSession),
    };
  }

  if (isExpired(input.currentSession, input.now, input.sessionTimeoutMs)) {
    return {
      action: 'start_new',
      effectiveUserMessageText,
      isExplicitNewSession: false,
      startReason: 'previous_expired',
      closeCurrentSession: closeSession(input.currentSession, 'expired', input.now),
    };
  }

  return {
    action: 'continue',
    effectiveUserMessageText: input.userMessageText,
    session: input.currentSession,
  };
}

function isTerminal(session: IntexAgentSession): boolean {
  return TERMINAL_STATUSES.has(session.status);
}

function isExpired(session: IntexAgentSession, now: string, timeoutMs: number): boolean {
  const lastUserMessageAt = getSessionTimestampMs(session.lastUserMessageAt);
  const nowMs = getSessionTimestampMs(now);
  return nowMs - lastUserMessageAt > timeoutMs;
}

function closeSession(
  session: IntexAgentSession,
  status: CloseCurrentSession['status'],
  endedAt: string
): CloseCurrentSession {
  return {
    id: session.id,
    endedAt,
    endReason: status === 'expired' ? 'timeout' : 'superseded_by_user',
    status,
  };
}

function startReasonAfterTerminal(session: IntexAgentSession): IntexAgentSessionStartReason {
  if (session.status === 'expired') {
    return 'previous_expired';
  }
  if (session.status === 'superseded') {
    return 'previous_superseded';
  }
  return 'previous_completed';
}

function summarizePriorSession(session: IntexAgentSession): PriorSessionSummary {
  return {
    id: session.id,
    status: session.status,
    ...(session.endReason !== undefined ? { endReason: session.endReason } : {}),
  };
}
