import { describe, expect, it } from 'vitest';
import {
  buildBehavioralTranscript,
  sanitizeAssistantReplies,
  sanitizeRecord,
  sanitizeEventsBySessionId,
  sanitizeToolCalls,
} from '../../domain/testConversation/testConversationSanitizer.js';
import type {
  CapturedToolCall,
  TestConversationTurnResult,
} from '../../domain/testConversation/testConversationTypes.js';
import type { IntexAgentSessionEvent } from '../../domain/sessions/types.js';

describe('test conversation sanitizer', () => {
  it('omits raw tool args, raw results, source urls, reply contexts, and secret-like payload fields', () => {
    const event: IntexAgentSessionEvent = {
      id: 'event-1',
      sessionId: 'intex_session_1',
      userId: 'test-intex-agent-run',
      type: 'confirmation_requested',
      createdAt: '2026-07-01T10:00:00.000Z',
      payload: {
        confirmationId: 'confirm-1',
        toolName: 'create_note',
        toolArgs: { content: 'private body', apiKey: 'secret-key' },
        message: 'Czy dodać notatkę?',
        sourceUrl: 'https://signed.example/private',
        whatsappSender: '+48123123123',
        replyContext: { text: 'previous private text' },
        token: 'secret-token',
      },
    };

    const sanitized = sanitizeEventsBySessionId({ intex_session_1: [event] });

    expect(sanitized).toEqual({
      intex_session_1: [
        {
          id: 'event-1',
          type: 'confirmation_requested',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: {
            confirmationId: 'confirm-1',
            toolName: 'create_note',
            textPreview: 'Czy dodać notatkę?',
          },
        },
      ],
    });
    expect(JSON.stringify(sanitized)).not.toContain('private body');
    expect(JSON.stringify(sanitized)).not.toContain('secret-key');
    expect(JSON.stringify(sanitized)).not.toContain('sourceUrl');
    expect(JSON.stringify(sanitized)).not.toContain('whatsappSender');
    expect(JSON.stringify(sanitized)).not.toContain('replyContext');
    expect(JSON.stringify(sanitized)).not.toContain('secret-token');
  });

  it('sanitizes captured tool call summaries recursively', () => {
    const calls: CapturedToolCall[] = [
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        argsSummary: { mode: 'list', token: 'secret-token' },
        resultSummary: {
          status: 'completed',
          count: 1,
          nested: { password: 'secret-password' },
        },
      },
    ];

    const sanitized = sanitizeToolCalls(calls);

    expect(sanitized).toEqual([
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        argsSummary: { mode: 'list' },
        resultSummary: { status: 'completed', count: 1, nested: {} },
      },
    ]);
  });

  it('sanitizes captured tool calls that have no optional summaries', () => {
    expect(sanitizeToolCalls([{ toolName: 'create_note', status: 'completed' }])).toEqual([
      { toolName: 'create_note', status: 'completed' },
    ]);
  });

  it('truncates errors and summarizes arrays without leaking unsupported values', () => {
    const sanitizedCalls = sanitizeToolCalls([
      {
        toolName: 'create_note',
        status: 'failed',
        argsSummary: { tags: ['private', 'labels'], authToken: 'secret-token' },
        error: 'x'.repeat(260),
      },
    ]);
    const record = sanitizeRecord({
      visible: '  hello   world  ',
      list: ['a', 'b', 'c'],
      nested: { secretKey: 'hidden', count: 2 },
      unsupported: Symbol('unsupported'),
    });

    expect(sanitizedCalls[0]?.error).toHaveLength(220);
    expect(JSON.stringify(sanitizedCalls)).not.toContain('secret-token');
    expect(record).toEqual({
      visible: 'hello world',
      list: { count: 3 },
      nested: { count: 2 },
    });
  });

  it('redacts captured reply URLs, source lines, prompt lines, and CTA URLs', () => {
    const sanitized = sanitizeAssistantReplies([
      {
        userId: 'test-intex-agent-run',
        message:
          'Czy wykonać?\nPrompt: tajna preferencja\nŹródło: https://signed.example/private\nOK',
        replyToMessageId: 'wamid-1',
        correlationId: 'intex_session_1',
        ctaUrl: { displayText: 'Open https://example.com/private', url: 'https://example.com/private' },
        buttons: [{ type: 'reply', reply: { id: 'intex_confirm:abc:yes', title: 'Tak' } }],
      },
    ]);

    expect(sanitized).toEqual([
      {
        userId: 'test-intex-agent-run',
        message: 'Czy wykonać? Prompt: [redacted] Źródło: [redacted] OK',
        replyToMessageId: 'wamid-1',
        correlationId: 'intex_session_1',
        ctaUrl: { displayText: 'Open [redacted-url]', url: '[redacted-url]' },
        buttons: [{ type: 'reply', reply: { id: 'intex_confirm:abc:yes', title: 'Tak' } }],
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('tajna preferencja');
    expect(JSON.stringify(sanitized)).not.toContain('https://signed.example/private');
  });

  it('redacts rendered prompt preference blocks in captured replies', () => {
    const sanitized = sanitizeAssistantReplies([
      {
        userId: 'test-intex-agent-run',
        message:
          'Here are the preferences.\nUser Preferences v3\n1. Always say tajne haslo\n- Use private tone\nDone.',
        replyToMessageId: 'wamid-1',
        correlationId: 'intex_session_1',
      },
      {
        userId: 'test-intex-agent-run',
        message: 'User Preferences v4\n1. hidden value\n\nNormal line.',
        replyToMessageId: 'wamid-2',
        correlationId: 'intex_session_1',
      },
    ]);

    expect(sanitized[0]?.message).toBe(
      'Here are the preferences. User Preferences: [redacted] [redacted-preference-item] [redacted-preference-item] Done.'
    );
    expect(sanitized[1]?.message).toBe(
      'User Preferences: [redacted] [redacted-preference-item] Normal line.'
    );
    expect(JSON.stringify(sanitized)).not.toContain('tajne haslo');
    expect(JSON.stringify(sanitized)).not.toContain('private tone');
    expect(JSON.stringify(sanitized)).not.toContain('hidden value');
  });

  it('summarizes tool completed events and omits secret-like result fields', () => {
    const sanitized = sanitizeEventsBySessionId({
      intex_session_1: [
        {
          id: 'event-1',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'tool_call_completed',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: {
            toolName: 'create_code_task',
            result: {
              status: 'completed',
              codeTaskId: 'task_mock',
              token: 'secret-token',
              events: [{ private: true }],
            },
          },
        },
      ],
    });

    expect(sanitized['intex_session_1']?.[0]?.payload).toEqual({
      toolName: 'create_code_task',
      resultSummary: { status: 'completed', codeTaskId: 'task_mock' },
    });
    expect(JSON.stringify(sanitized)).not.toContain('secret-token');
    expect(JSON.stringify(sanitized)).not.toContain('private');
  });

  it('builds a normalized behavioral transcript from turns, events, transitions, and tool calls', () => {
    const turns: TestConversationTurnResult[] = [
      {
        turnIndex: 0,
        kind: 'message',
        messageId: 'wamid-1',
        sessionId: 'intex_session_1',
        submittedTextPreview: 'Jakie wydarzenia jutro?',
        assistantReplies: [
          {
            userId: 'test-intex-agent-run',
            message: 'Nie masz żadnych wydarzeń jutro.',
            replyToMessageId: 'wamid-1',
            correlationId: 'intex_session_1',
          },
        ],
      },
    ];

    const transcript = buildBehavioralTranscript({
      turns,
      sessionTransitions: [{ turnIndex: 0, action: 'started', sessionId: 'intex_session_1' }],
      eventsBySessionId: {
        intex_session_1: [
          {
            id: 'event-1',
            sessionId: 'intex_session_1',
            userId: 'test-intex-agent-run',
            type: 'tool_call_completed',
            createdAt: '2026-07-01T10:00:00.000Z',
            payload: { toolName: 'query_calendar_events' },
          },
        ],
      },
      toolCalls: [{ toolName: 'query_calendar_events', status: 'completed' }],
    });

    expect(transcript).toEqual({
      turns: [
        {
          turnIndex: 0,
          submittedTextPreview: 'Jakie wydarzenia jutro?',
          assistantReplyPreviews: ['Nie masz żadnych wydarzeń jutro.'],
          sessionAction: 'started',
          toolOutcome: { toolName: 'query_calendar_events', status: 'completed' },
        },
      ],
    });
  });

  it('derives stale confirmations and tool outcomes from events when captured calls are absent', () => {
    const turns: TestConversationTurnResult[] = [
      {
        turnIndex: 0,
        kind: 'confirmation_button',
        messageId: 'wamid-1',
        sessionId: 'intex_session_1',
        assistantReplies: [],
      },
      {
        turnIndex: 1,
        kind: 'message',
        messageId: 'wamid-2',
        sessionId: 'intex_session_2',
        assistantReplies: [{ userId: 'u', message: 'done', replyToMessageId: 'wamid-2', correlationId: 's' }],
      },
    ];

    const transcript = buildBehavioralTranscript({
      turns,
      sessionTransitions: [],
      eventsBySessionId: {
        intex_session_1: [
          {
            id: 'event-1',
            sessionId: 'intex_session_1',
            userId: 'test-intex-agent-run',
            type: 'confirmation_resolved',
            createdAt: '2026-07-01T10:00:00.000Z',
            payload: { resolution: 'expired' },
          },
          {
            id: 'event-2',
            sessionId: 'intex_session_1',
            userId: 'test-intex-agent-run',
            type: 'tool_call_failed',
            createdAt: '2026-07-01T10:00:01.000Z',
            payload: { toolName: 'create_note' },
          },
        ],
        intex_session_2: [
          {
            id: 'event-3',
            sessionId: 'intex_session_2',
            userId: 'test-intex-agent-run',
            type: 'tool_call_completed',
            createdAt: '2026-07-01T10:00:02.000Z',
            payload: { toolName: 'query_calendar_events' },
          },
        ],
      },
      toolCalls: [],
    });

    expect(transcript).toEqual({
      turns: [
        {
          turnIndex: 0,
          assistantReplyPreviews: [],
          sessionAction: 'continued',
          confirmationAction: 'stale',
          toolOutcome: { toolName: 'create_note', status: 'failed' },
        },
        {
          turnIndex: 1,
          assistantReplyPreviews: ['done'],
          sessionAction: 'continued',
          toolOutcome: { toolName: 'query_calendar_events', status: 'completed' },
        },
      ],
    });
  });

  it('uses per-turn events and tool calls when building behavioral transcripts', () => {
    const turns: TestConversationTurnResult[] = [
      {
        turnIndex: 0,
        kind: 'message',
        messageId: 'wamid-1',
        sessionId: 'intex_session_1',
        assistantReplies: [{ userId: 'u', message: 'first', replyToMessageId: 'wamid-1', correlationId: 's' }],
      },
      {
        turnIndex: 1,
        kind: 'message',
        messageId: 'wamid-2',
        sessionId: 'intex_session_1',
        assistantReplies: [{ userId: 'u', message: 'second', replyToMessageId: 'wamid-2', correlationId: 's' }],
      },
    ];

    const transcript = buildBehavioralTranscript({
      turns,
      sessionTransitions: [
        { turnIndex: 0, action: 'started', sessionId: 'intex_session_1' },
        { turnIndex: 1, action: 'continued', sessionId: 'intex_session_1' },
      ],
      eventsBySessionId: {
        intex_session_1: [
          {
            id: 'event-1',
            sessionId: 'intex_session_1',
            userId: 'test-intex-agent-run',
            type: 'tool_call_completed',
            createdAt: '2026-07-01T10:00:00.000Z',
            payload: { toolName: 'create_note' },
          },
        ],
      },
      toolCalls: [{ toolName: 'create_note', status: 'completed' }],
      turnEventsByTurnIndex: { 0: [], 1: [] },
      toolCallsByTurnIndex: { 0: [], 1: [{ toolName: 'query_calendar_events', status: 'completed' }] },
    });

    expect(transcript.turns[0]).not.toHaveProperty('toolOutcome');
    expect(transcript.turns[1]).toMatchObject({
      toolOutcome: { toolName: 'query_calendar_events', status: 'completed' },
    });
  });

  it('prefers failed captured tool calls in behavioral transcripts', () => {
    const transcript = buildBehavioralTranscript({
      turns: [
        {
          turnIndex: 0,
          kind: 'message',
          messageId: 'wamid-1',
          sessionId: 'intex_session_1',
          assistantReplies: [],
        },
      ],
      sessionTransitions: [{ turnIndex: 0, action: 'started', sessionId: 'intex_session_1' }],
      eventsBySessionId: {},
      toolCalls: [{ toolName: 'create_note', status: 'failed' }],
    });

    expect(transcript.turns[0]).toMatchObject({
      toolOutcome: { toolName: 'create_note', status: 'failed' },
    });
  });
});
