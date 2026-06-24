import { describe, expect, it } from 'vitest';
import type { IntexIncomingMessage } from '../../domain/ports/incomingMessageHandler.js';
import type {
  SessionRepository,
  SessionRepositorySessionDraft,
  SessionRepositorySessionUpdate,
} from '../../domain/ports/sessionRepository.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
} from '../../domain/sessions/types.js';
import {
  handleIncomingMessage,
  type IntexAgentRunner,
  type IntexAgentRunnerResult,
  type WhatsAppReplyPublisher,
} from '../../domain/messages/handleIncomingMessage.js';

const NOW = '2026-06-24T10:00:00.000Z';

function message(overrides: Partial<IntexIncomingMessage> = {}): IntexIncomingMessage {
  return {
    type: 'intex.message.ingest',
    userId: 'user-1',
    messageId: 'wamid-1',
    text: 'remember that the door code is 1234',
    sourceType: 'whatsapp_text',
    timestamp: NOW,
    ...overrides,
  };
}

describe('handleIncomingMessage', () => {
  it('creates a new session, executes a note request, replies, and closes the session', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Saved that note.',
        summary: 'Saved door code note.',
        toolName: 'create_note',
      },
    ]);
    const replies = new FakeReplyPublisher();

    const result = await handleIncomingMessage(message(), deps(repo, runner, replies));

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(repo.sessions[0]).toMatchObject({
      id: 'session-1',
      status: 'completed',
      endReason: 'tool_completed',
      summary: 'Saved door code note.',
    });
    expect(eventTypes(repo)).toEqual([
      'session_started',
      'user_message',
      'tool_call_completed',
      'assistant_message',
      'session_closed',
    ]);
    expect(replies.messages).toEqual([
      {
        userId: 'user-1',
        message: 'New session started.\n\nSaved that note.',
        replyToMessageId: 'wamid-1',
        correlationId: 'session-1',
      },
    ]);
  });

  it('creates a calendar event in one message when the request has complete date and time details', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Created the calendar event.',
        summary: 'Created dentist appointment.',
        toolName: 'create_calendar_event',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'create a dentist appointment tomorrow 9-10am' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.status).toBe('completed');
    expect(repo.sessions[0]?.activeTool).toBe('create_calendar_event');
    expect(eventPayloads(repo, 'tool_call_completed')[0]).toMatchObject({
      toolName: 'create_calendar_event',
    });
    expect(replies.messages[0]?.message).toBe('New session started.\n\nCreated the calendar event.');
  });

  it('asks for clarification and keeps the session waiting when a calendar date is missing', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_clarification',
        reply: 'New session started.\n\nWhich day should I schedule it for?',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'create a calendar event for a dentist appointment at 9am' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.status).toBe('waiting_for_user');
    expect(eventTypes(repo)).toEqual([
      'session_started',
      'user_message',
      'clarification_requested',
      'assistant_message',
    ]);
    expect(replies.messages[0]?.message).toBe(
      'New session started.\n\nWhich day should I schedule it for?'
    );
  });

  it('continues a waiting session when the user answers a clarification', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      lastAssistantMessageAt: '2026-06-24T09:51:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      text: 'create a calendar event for dentist at 9am',
    });
    repo.seedEvent('session-existing', 'clarification_requested', {
      message: 'Which day should I schedule it for?',
    });
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Scheduled it for tomorrow.',
        summary: 'Created dentist appointment.',
        toolName: 'create_calendar_event',
      },
    ]);
    const replies = new FakeReplyPublisher();

    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'tomorrow' }),
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'session-existing' });
    expect(repo.sessions[0]?.status).toBe('completed');
    expect(repo.createdSessions).toHaveLength(0);
    expect(runner.calls[0]?.session.id).toBe('session-existing');
    expect(replies.messages).toEqual([
      {
        userId: 'user-1',
        message: 'Scheduled it for tomorrow.',
        replyToMessageId: 'wamid-2',
        correlationId: 'session-existing',
      },
    ]);
  });

  it('replies unsupported and closes the session for unsupported requests', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'unsupported',
        reply: 'I do not support that yet. I can create notes and calendar events.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ text: 'book me a flight to Lisbon' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.status).toBe('unsupported');
    expect(repo.sessions[0]?.endReason).toBe('unsupported_request');
    expect(repo.sessions[0]?.summary).toBe('book me a flight to Lisbon');
    expect(eventTypes(repo)).toEqual([
      'session_started',
      'user_message',
      'unsupported_request',
      'assistant_message',
      'session_closed',
    ]);
    expect(replies.messages[0]?.message).toBe(
      'New session started.\n\nI do not support that yet. I can create notes and calendar events.'
    );
  });

  it('truncates unsupported session summaries from long user messages', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'unsupported',
        reply: 'I can only create notes and calendar events.',
      },
    ]);
    const replies = new FakeReplyPublisher();
    const longText = 'What are events in my calendar tomorrow and which ones conflict with preparation time';
    const repeatedText = `${longText} ${longText}`;

    await handleIncomingMessage(
      message({ text: repeatedText }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions[0]?.summary).toBe(`${repeatedText.slice(0, 117)}...`);
  });

  it('normalizes WhatsApp epoch-second timestamps and records fresh event timestamps', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'unsupported',
        reply: 'I can only create notes and calendar events.',
      },
    ]);
    const replies = new FakeReplyPublisher();
    const clock = new SequenceClock([
      '2026-06-24T16:10:19.000Z',
      '2026-06-24T16:10:19.001Z',
      '2026-06-24T16:10:19.002Z',
      '2026-06-24T16:10:20.000Z',
      '2026-06-24T16:10:20.001Z',
      '2026-06-24T16:10:20.002Z',
      '2026-06-24T16:10:20.003Z',
    ]);

    await handleIncomingMessage(
      message({
        timestamp: '1782317416',
        text: 'What are events in my calendar tomorrow?',
      }),
      deps(repo, runner, replies, clock)
    );

    expect(repo.sessions[0]?.lastUserMessageAt).toBe('2026-06-24T16:10:16.000Z');
    expect(new Set(repo.events.map((event) => event.createdAt)).size).toBe(repo.events.length);
  });

  it('supersedes an open session and starts an idle one for an explicit new-session command', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    const runner = new FakeRunner([]);
    const replies = new FakeReplyPublisher();

    const result = await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'new session' }),
      deps(repo, runner, replies)
    );

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(repo.sessions).toMatchObject([
      {
        id: 'session-existing',
        status: 'superseded',
        endReason: 'superseded_by_user',
      },
      {
        id: 'session-1',
        status: 'waiting_for_user',
        startReason: 'user_requested_new_session',
      },
    ]);
    expect(eventTypes(repo)).toEqual([
      'session_closed',
      'session_started',
      'assistant_message',
    ]);
    expect(runner.calls).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'Previous session superseded. New session started.\n\nWhat would you like me to help with? I can create notes and calendar events.'
    );
  });

  it('expires a stale session, starts a new one, and completes without optional summary metadata', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-stale',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:00:00.000Z',
      lastUserMessageAt: '2026-06-24T09:00:00.000Z',
      startReason: 'no_active_session',
    });
    const runner = new FakeRunner([
      {
        outcome: 'completed',
        reply: 'Saved it.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({ messageId: 'wamid-2', text: 'remember the garage code' }),
      deps(repo, runner, replies)
    );

    expect(repo.sessions).toMatchObject([
      {
        id: 'session-stale',
        status: 'expired',
        endReason: 'timeout',
      },
      {
        id: 'session-1',
        status: 'completed',
        endReason: 'tool_completed',
      },
    ]);
    expect(repo.sessions[1]?.activeTool).toBeUndefined();
    expect(repo.sessions[1]?.summary).toBeUndefined();
    expect(eventPayloads(repo, 'tool_call_completed')).toEqual([{}]);
    expect(replies.messages[0]?.message).toBe(
      'Previous session expired. New session started.\n\nSaved it.'
    );
  });
});

function deps(
  sessionRepository: FakeSessionRepository,
  runner: FakeRunner,
  replies: FakeReplyPublisher,
  clock: { now: () => string } = { now: () => NOW }
): Parameters<typeof handleIncomingMessage>[1] {
  return {
    sessionRepository,
    runner,
    replyPublisher: replies,
    clock,
    ids: {
      sessionId: () => `session-${String(sessionRepository.createdSessions.length + 1)}`,
      eventId: () => `event-${String(sessionRepository.events.length + 1)}`,
    },
    sessionTimeoutMs: 30 * 60 * 1000,
  };
}

class SequenceClock {
  private index = 0;

  constructor(private readonly values: string[]) {}

  now(): string {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error('No fake clock value configured');
    }
    this.index += 1;
    return value;
  }
}

function eventTypes(repo: FakeSessionRepository): IntexAgentSessionEventType[] {
  return repo.events.map((event) => event.type);
}

function eventPayloads(
  repo: FakeSessionRepository,
  type: IntexAgentSessionEventType
): Record<string, unknown>[] {
  return repo.events.filter((event) => event.type === type).map((event) => event.payload);
}

class FakeSessionRepository implements SessionRepository {
  readonly sessions: IntexAgentSession[] = [];
  readonly events: IntexAgentSessionEvent[] = [];
  readonly createdSessions: IntexAgentSession[] = [];

  seedSession(session: IntexAgentSession): void {
    this.sessions.push(session);
  }

  seedEvent(sessionId: string, type: IntexAgentSessionEventType, payload: Record<string, unknown>): void {
    this.events.push({
      id: `seed-${String(this.events.length + 1)}`,
      sessionId,
      userId: 'user-1',
      type,
      payload,
      createdAt: NOW,
    });
  }

  listSessions(userId: string): Promise<IntexAgentSession[]> {
    return Promise.resolve(this.sessions.filter((session) => session.userId === userId));
  }

  getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null> {
    return Promise.resolve(
      this.sessions.find((session) => session.id === sessionId && session.userId === userId) ?? null
    );
  }

  listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]> {
    return Promise.resolve(
      this.events.filter((event) => event.sessionId === sessionId && event.userId === userId)
    );
  }

  findOpenSession(userId: string): Promise<IntexAgentSession | null> {
    return Promise.resolve(
      this.sessions.find(
        (session) =>
          session.userId === userId &&
          ['active', 'waiting_for_user', 'executing_tool'].includes(session.status)
      ) ?? null
    );
  }

  createSession(draft: SessionRepositorySessionDraft): Promise<IntexAgentSession> {
    const session: IntexAgentSession = { ...draft };
    this.sessions.push(session);
    this.createdSessions.push(session);
    return Promise.resolve(session);
  }

  updateSession(sessionId: string, update: SessionRepositorySessionUpdate): Promise<IntexAgentSession> {
    const index = this.sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) {
      throw new Error(`Missing session ${sessionId}`);
    }
    const updated: IntexAgentSession = { ...this.sessions[index], ...update } as IntexAgentSession;
    this.sessions[index] = updated;
    return Promise.resolve(updated);
  }

  appendEvent(event: IntexAgentSessionEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class FakeRunner implements IntexAgentRunner {
  readonly calls: { session: IntexAgentSession; events: IntexAgentSessionEvent[]; message: string }[] =
    [];

  constructor(private readonly results: IntexAgentRunnerResult[]) {}

  run(input: {
    session: IntexAgentSession;
    events: IntexAgentSessionEvent[];
    message: string;
  }): Promise<IntexAgentRunnerResult> {
    this.calls.push(input);
    const next = this.results.shift();
    if (next === undefined) {
      throw new Error('No fake runner result configured');
    }
    return Promise.resolve(next);
  }
}

class FakeReplyPublisher implements WhatsAppReplyPublisher {
  readonly messages: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
  }[] = [];

  publishReply(input: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
  }): Promise<void> {
    this.messages.push(input);
    return Promise.resolve();
  }
}
