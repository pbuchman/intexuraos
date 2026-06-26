import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';
import {
  formatSessionDateTimeCompact,
  formatSessionRelative,
  getSessionTitle,
  parseSessionTimestamp,
  sortSessionEventsForTimeline,
} from '../sessionPresentation.js';

function session(overrides: Partial<IntexAgentSession> = {}): IntexAgentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    channel: 'whatsapp',
    status: 'unsupported',
    startedAt: '2026-06-24T16:10:19.341Z',
    lastUserMessageAt: '1782317416',
    startReason: 'no_active_session',
    endReason: 'unsupported_request',
    ...overrides,
  };
}

function event(
  id: string,
  type: IntexAgentSessionEvent['type'],
  overrides: Partial<IntexAgentSessionEvent> = {}
): IntexAgentSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    userId: 'user-1',
    type,
    payload: {},
    createdAt: '2026-06-24T16:10:19.341Z',
    ...overrides,
  };
}

describe('Intex session presentation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T16:15:16.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses WhatsApp epoch-second timestamps before formatting them', () => {
    expect(parseSessionTimestamp('1782317416')?.toISOString()).toBe(
      '2026-06-24T16:10:16.000Z'
    );
    expect(formatSessionRelative('1782317416')).toBe('5m ago');
    expect(formatSessionDateTimeCompact('1782317416')).not.toContain('Invalid');
  });

  it('uses stable meaningful titles instead of Unknown for sessions without summaries', () => {
    expect(getSessionTitle(session({ summary: 'What are events in my calendar tomorrow?' }))).toBe(
      'What are events in my calendar tomorrow?'
    );
    expect(getSessionTitle(session())).toBe('Unsupported Request');
  });

  it('sorts equal-timestamp events in chronological conversation order', () => {
    const sorted = sortSessionEventsForTimeline([
      event('assistant', 'assistant_message'),
      event('unsupported', 'unsupported_request'),
      event('user', 'user_message'),
      event('closed', 'session_closed'),
      event('started', 'session_started'),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      'started',
      'user',
      'unsupported',
      'assistant',
      'closed',
    ]);
  });
});
