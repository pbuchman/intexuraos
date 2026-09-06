import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';
import {
  formatSessionDateTimeCompact,
  formatSessionRelative,
  getSessionTitle,
  parseSessionTimestamp,
  projectSessionEventsForTimeline,
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
    const sorted = projectSessionEventsForTimeline([
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

  it('hides only an immediately repeated clarification reply without mutating source events', () => {
    const events = [
      event('clarification', 'clarification_requested', {
        payload: { message: '  Which day\nshould I use?  ' },
        createdAt: '2026-06-24T16:10:20.000Z',
      }),
      event('duplicate-assistant', 'assistant_message', {
        payload: { text: 'Which day should I use?' },
        createdAt: '2026-06-24T16:10:21.000Z',
      }),
    ];

    const projected = projectSessionEventsForTimeline(events);

    expect(projected.map((item) => item.id)).toEqual(['clarification']);
    expect(events.map((item) => item.id)).toEqual(['clarification', 'duplicate-assistant']);
  });

  it('preserves distinct adjacent messages and matching replies separated by another event', () => {
    const projected = projectSessionEventsForTimeline([
      event('first-clarification', 'clarification_requested', {
        payload: { message: 'Which day?' },
        createdAt: '2026-06-24T16:10:20.000Z',
      }),
      event('distinct-assistant', 'assistant_message', {
        payload: { text: 'Which time?' },
        createdAt: '2026-06-24T16:10:21.000Z',
      }),
      event('second-clarification', 'clarification_requested', {
        payload: { message: 'Which location?' },
        createdAt: '2026-06-24T16:10:22.000Z',
      }),
      event('intervening-tool', 'tool_call_started', {
        payload: { toolName: 'create_calendar_event' },
        createdAt: '2026-06-24T16:10:23.000Z',
      }),
      event('non-adjacent-assistant', 'assistant_message', {
        payload: { text: 'Which location?' },
        createdAt: '2026-06-24T16:10:24.000Z',
      }),
    ]);

    expect(projected.map((item) => item.id)).toEqual([
      'first-clarification',
      'distinct-assistant',
      'second-clarification',
      'intervening-tool',
      'non-adjacent-assistant',
    ]);
  });
});
