import { describe, expect, it } from 'vitest';
import {
  decideSessionTransition,
  type SessionTransitionInput,
} from '../../domain/sessions/sessionController.js';
import type { IntexAgentSession } from '../../domain/sessions/types.js';

const baseTime = '2026-06-24T10:00:00.000Z';
const timeoutMs = 30 * 60 * 1000;

function session(overrides: Partial<IntexAgentSession> = {}): IntexAgentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    channel: 'whatsapp',
    status: 'waiting_for_user',
    startedAt: '2026-06-24T09:00:00.000Z',
    lastUserMessageAt: '2026-06-24T09:55:00.000Z',
    startReason: 'no_active_session',
    activeTool: 'create_calendar_event',
    ...overrides,
  };
}

function decide(input: Partial<SessionTransitionInput>): ReturnType<typeof decideSessionTransition> {
  return decideSessionTransition({
    currentSession: null,
    now: baseTime,
    userMessageText: 'Remember the gate code is 4938',
    sessionTimeoutMs: timeoutMs,
    ...input,
  });
}

describe('decideSessionTransition', () => {
  it('starts a new session when no active session exists', () => {
    expect(decide({ currentSession: null })).toEqual({
      action: 'start_new',
      effectiveUserMessageText: 'Remember the gate code is 4938',
      isExplicitNewSession: false,
      startReason: 'no_active_session',
    });
  });

  it('starts a new session after a completed prior session and preserves that reason', () => {
    expect(
      decide({
        currentSession: session({
          status: 'completed',
          endedAt: '2026-06-24T09:59:00.000Z',
          endReason: 'tool_completed',
        }),
      })
    ).toEqual({
      action: 'start_new',
      effectiveUserMessageText: 'Remember the gate code is 4938',
      isExplicitNewSession: false,
      startReason: 'previous_completed',
      previousSession: {
        id: 'session-1',
        status: 'completed',
        endReason: 'tool_completed',
      },
    });
  });

  it('starts a new session after an expired terminal session', () => {
    expect(
      decide({
        currentSession: session({
          status: 'expired',
          endedAt: '2026-06-24T09:59:00.000Z',
        }),
      })
    ).toEqual({
      action: 'start_new',
      effectiveUserMessageText: 'Remember the gate code is 4938',
      isExplicitNewSession: false,
      startReason: 'previous_expired',
      previousSession: {
        id: 'session-1',
        status: 'expired',
      },
    });
  });

  it('starts a new session after a superseded terminal session', () => {
    expect(
      decide({
        currentSession: session({
          status: 'superseded',
          endedAt: '2026-06-24T09:59:00.000Z',
          endReason: 'superseded_by_user',
        }),
      })
    ).toEqual({
      action: 'start_new',
      effectiveUserMessageText: 'Remember the gate code is 4938',
      isExplicitNewSession: false,
      startReason: 'previous_superseded',
      previousSession: {
        id: 'session-1',
        status: 'superseded',
        endReason: 'superseded_by_user',
      },
    });
  });

  it('continues a waiting session when the user answers a clarification', () => {
    const currentSession = session();

    expect(
      decide({
        currentSession,
        userMessageText: 'Next Tuesday',
      })
    ).toEqual({
      action: 'continue',
      effectiveUserMessageText: 'Next Tuesday',
      session: currentSession,
    });
  });

  it('supersedes a waiting session when the user explicitly starts a new session', () => {
    expect(
      decide({
        currentSession: session(),
        userMessageText: 'new session: remember that backup code is 9988',
      })
    ).toEqual({
      action: 'start_new',
      effectiveUserMessageText: 'remember that backup code is 9988',
      isExplicitNewSession: true,
      startReason: 'user_requested_new_session',
      closeCurrentSession: {
        id: 'session-1',
        endedAt: baseTime,
        endReason: 'superseded_by_user',
        status: 'superseded',
      },
    });
  });

  it('starts an idle new session when the explicit command has no request text', () => {
    expect(
      decide({
        currentSession: session(),
        userMessageText: 'new session',
      })
    ).toEqual({
      action: 'start_new',
      effectiveUserMessageText: null,
      isExplicitNewSession: true,
      startReason: 'user_requested_new_session',
      closeCurrentSession: {
        id: 'session-1',
        endedAt: baseTime,
        endReason: 'superseded_by_user',
        status: 'superseded',
      },
    });
  });

  it('starts an explicit new session without closing a terminal current session', () => {
    expect(
      decide({
        currentSession: session({
          status: 'completed',
          endedAt: '2026-06-24T09:59:00.000Z',
        }),
        userMessageText: 'new session: remember that backup code is 9988',
      })
    ).toEqual({
      action: 'start_new',
      effectiveUserMessageText: 'remember that backup code is 9988',
      isExplicitNewSession: true,
      startReason: 'user_requested_new_session',
    });
  });

  it('expires a stale waiting session before starting a new one', () => {
    expect(
      decide({
        currentSession: session({
          lastUserMessageAt: '2026-06-24T09:00:00.000Z',
        }),
      })
    ).toEqual({
      action: 'start_new',
      effectiveUserMessageText: 'Remember the gate code is 4938',
      isExplicitNewSession: false,
      startReason: 'previous_expired',
      closeCurrentSession: {
        id: 'session-1',
        endedAt: baseTime,
        endReason: 'timeout',
        status: 'expired',
      },
    });
  });
});
