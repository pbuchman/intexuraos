import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as sanitizerModule from '../../domain/testConversation/testConversationSanitizer.js';
import {
  buildBehavioralTranscript,
  sanitizeAssistantReplies,
  sanitizeRecord,
  sanitizeEventsBySessionId,
  sanitizeSessions,
  sanitizeToolCalls,
} from '../../domain/testConversation/testConversationSanitizer.js';
import type {
  CapturedAssistantReply,
  CapturedToolCall,
  SanitizedToolCall,
  TestConversationTurnResult,
} from '../../domain/testConversation/testConversationTypes.js';
import type { IntexAgentSessionEvent } from '../../domain/sessions/types.js';

describe('test conversation sanitizer', () => {
  it('projects narrow per-turn timeline events and immediate session state', () => {
    const sanitizeTurnTimelineEvents = (
      sanitizerModule as unknown as {
        sanitizeTurnTimelineEvents?: (
          events: readonly IntexAgentSessionEvent[]
        ) => Record<string, unknown>[];
      }
    ).sanitizeTurnTimelineEvents;
    const sanitizeSessionAfterTurn = (
      sanitizerModule as unknown as {
        sanitizeSessionAfterTurn?: (session: Record<string, unknown>) => Record<string, unknown>;
      }
    ).sanitizeSessionAfterTurn;

    expect(sanitizeTurnTimelineEvents).toBeTypeOf('function');
    expect(sanitizeSessionAfterTurn).toBeTypeOf('function');
    if (sanitizeTurnTimelineEvents === undefined || sanitizeSessionAfterTurn === undefined) return;

    const timeline = sanitizeTurnTimelineEvents([
      {
        id: 'event-user',
        sessionId: 'intex_session_1',
        userId: 'test-intex-agent-secret-user',
        type: 'user_message',
        createdAt: '2026-07-01T10:00:00.000Z',
        payload: {
          text: 'Content: private-message-sentinel',
          sourceType: 'whatsapp_audio_transcript',
          toolArgs: { content: 'private-tool-args' },
          result: { message: 'private-result' },
          sourceUrl: 'https://example.com/private',
          whatsappSender: '+48123123123',
          replyContext: { text: 'private-reply-context' },
          promptBlock: 'private-preference',
          secretKey: 'private-secret',
          userId: 'private-user-id',
          timestamp: 'private-timestamp',
          channel: 'private-channel',
          summary: 'private-summary',
        },
      },
      {
        id: 'event-assistant',
        sessionId: 'intex_session_1',
        userId: 'test-intex-agent-secret-user',
        type: 'assistant_message',
        createdAt: '2026-07-01T10:00:01.000Z',
        payload: { message: 'Safe assistant reply', sourceType: 'must-not-copy' },
      },
    ]);
    const snapshot = sanitizeSessionAfterTurn({
      id: 'intex_session_1',
      userId: 'test-intex-agent-secret-user',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-07-01T10:00:00.000Z',
      endedAt: '2026-07-01T10:00:01.000Z',
      lastUserMessageAt: '2026-07-01T10:00:00.000Z',
      lastAssistantMessageAt: '2026-07-01T10:00:01.000Z',
      startReason: 'no_active_session',
      endReason: 'tool_completed',
      activeTool: 'create_note',
      summary: 'private-session-summary',
    });

    expect(timeline).toEqual([
      {
        sessionId: 'intex_session_1',
        id: 'event-user',
        type: 'user_message',
        createdAt: '2026-07-01T10:00:00.000Z',
        payload: {
          sourceType: 'whatsapp_audio_transcript',
          textPreview: 'Content: [redacted]',
        },
      },
      {
        sessionId: 'intex_session_1',
        id: 'event-assistant',
        type: 'assistant_message',
        createdAt: '2026-07-01T10:00:01.000Z',
        payload: { textPreview: 'Safe assistant reply' },
      },
    ]);
    expect(snapshot).toEqual({
      id: 'intex_session_1',
      status: 'waiting_for_user',
      startReason: 'no_active_session',
      endReason: 'tool_completed',
      activeTool: 'create_note',
    });
    expect(JSON.stringify({ timeline, snapshot })).not.toMatch(
      /private-message-sentinel|private-tool-args|private-result|private-reply-context|private-preference|private-secret|private-user-id|private-timestamp|private-channel|private-summary|private-session-summary|must-not-copy/u
    );
  });

  it('summarizes only complete canonical synthetic markers without exposing their tokens', () => {
    const summarizeArgs = (
      sanitizerModule as unknown as {
        summarizeArgs?: (
          toolName: 'create_note' | 'create_calendar_event' | 'query_calendar_events',
          args: Record<string, unknown>
        ) => Record<string, unknown>;
      }
    ).summarizeArgs;

    expect(summarizeArgs).toBeTypeOf('function');
    if (summarizeArgs === undefined) return;

    const first = summarizeArgs('create_note', {
      content:
        'secret-alpha INTEX-eval-001-f02 INTEX-EVAL-001 INTEX-EVAL-001-F01 INTEX-EVAL-001-F01',
    });
    const second = summarizeArgs('create_note', {
      content: 'different-secret INTEX-EVAL-001-F01 INTEX-EVAL-001-F02 INTEX-EVAL-001',
    });
    const disallowed = summarizeArgs('create_note', {
      content: 'INTEX-EVAL-001-PRIVATE XINTEX-EVAL-002 INTEX-EVAL-003-F021',
    });

    expect(first).toMatchObject({
      syntheticMarkerCount: 3,
      syntheticMarkerDigest: markerDigest([
        'INTEX-EVAL-001',
        'INTEX-EVAL-001-F01',
        'INTEX-EVAL-001-F02',
      ]),
    });
    expect(second).toMatchObject({
      syntheticMarkerCount: first['syntheticMarkerCount'],
      syntheticMarkerDigest: first['syntheticMarkerDigest'],
    });
    expect(disallowed).toMatchObject({
      syntheticMarkerCount: 0,
      syntheticMarkerDigest: markerDigest([]),
    });
    expect(JSON.stringify(first)).not.toMatch(/secret-alpha|INTEX-EVAL/iu);

    const rawCalendarQuery = 'private search INTEX-EVAL-011-F01';
    const querySummary = summarizeArgs('query_calendar_events', {
      mode: 'list',
      timeMin: '2026-07-18T00:00:00+02:00',
      timeMax: '2026-07-19T00:00:00+02:00',
      maxResults: 10,
      query: rawCalendarQuery,
      calendarId: 'private-calendar-id',
    });
    expect(querySummary).toEqual({
      mode: 'list',
      timeMin: '2026-07-18T00:00:00+02:00',
      timeMax: '2026-07-19T00:00:00+02:00',
      maxResults: 10,
      queryLength: rawCalendarQuery.length,
      hasCalendarId: true,
      syntheticMarkerCount: 1,
      syntheticMarkerDigest: markerDigest(['INTEX-EVAL-011-F01']),
    });
    expect(JSON.stringify(querySummary)).not.toMatch(/private search|INTEX-EVAL/iu);

    const calendar = summarizeArgs('create_calendar_event', {
      summary: 'Synthetic event',
      start: '2026-08-18T14:30:00+02:00 INTEX-EVAL-002-F01',
      end: '2026-08-18T15:15:00+02:00',
    });
    expect(calendar).not.toHaveProperty('start');
    expect(calendar['end']).toBe('2026-08-18T15:15:00+02:00');
    expect(calendar).toMatchObject({
      syntheticMarkerCount: 1,
      syntheticMarkerDigest: markerDigest(['INTEX-EVAL-002-F01']),
    });
    expect(JSON.stringify(calendar)).not.toContain('INTEX-EVAL');
  });

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
        toolArgs: {
          content: 'private body INTEX-EVAL-001 INTEX-EVAL-001-F01',
          apiKey: 'secret-key',
        },
        message: 'Czy dodać notatkę?\nTreść: private body INTEX-EVAL-001-F01',
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
            textPreview: 'Czy dodać notatkę? Treść: [redacted]',
            argsSummary: {
              contentLength: 46,
              syntheticMarkerCount: 2,
              syntheticMarkerDigest: markerDigest([
                'INTEX-EVAL-001',
                'INTEX-EVAL-001-F01',
              ]),
            },
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
    expect(JSON.stringify(sanitized)).not.toContain('INTEX-EVAL-001');
  });

  it('omits argument evidence for malformed confirmation payloads', () => {
    const sanitized = sanitizeEventsBySessionId({
      intex_session_1: [
        {
          id: 'event-1',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'confirmation_requested',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: { toolName: 'create_note', message: 'Confirm?' },
        },
        {
          id: 'event-2',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'confirmation_requested',
          createdAt: '2026-07-01T10:00:01.000Z',
          payload: {
            toolName: 'not_a_tool',
            toolArgs: { content: 'INTEX-EVAL-001-F01' },
            message: 'Confirm?',
          },
        },
      ],
    });

    expect(sanitized['intex_session_1']?.map((event) => event.payload)).toEqual([
      { toolName: 'create_note', textPreview: 'Confirm?' },
      { toolName: 'not_a_tool', textPreview: 'Confirm?' },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('INTEX-EVAL');
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
        resultSummary: { status: 'completed', count: 1 },
      },
    ]);
  });

  it('uses closed summary DTOs without string index signatures', () => {
    type HasStringIndex<T> = string extends keyof T ? true : false;
    const argsSummaryHasStringIndex: HasStringIndex<
      NonNullable<SanitizedToolCall['argsSummary']>
    > = false;
    const resultSummaryHasStringIndex: HasStringIndex<
      NonNullable<SanitizedToolCall['resultSummary']>
    > = false;

    expect(argsSummaryHasStringIndex).toBe(false);
    expect(resultSummaryHasStringIndex).toBe(false);
  });

  it('runtime-allowlists typed tool summaries and rejects arbitrary or malformed values', () => {
    const digest = markerDigest(['INTEX-EVAL-011-F01']);
    const sanitized = sanitizeToolCalls([
      {
        toolName: 'create_calendar_event',
        status: 'completed',
        argsSummary: {
          mode: 'count',
          start: '2026-07-18T10:00:00+02:00',
          end: '2026-07-18T11:00:00+02:00',
          timeMin: '2026-07-18T00:00:00Z',
          timeMax: '2026-07-19T00:00:00Z',
          timeZone: 'Europe/Warsaw',
          workerType: 'minimax',
          taskMode: 'planning',
          maxResults: 10,
          queryLength: 33,
          hasCalendarId: true,
          syntheticMarkerCount: 1,
          syntheticMarkerDigest: digest,
          neutralKey: 'neutral-string-sentinel',
        },
        resultSummary: {
          status: 'completed',
          mode: 'list',
          count: 0,
          currentVersion: 3,
          hasEventId: true,
          hasResourceUrl: false,
          neutralResult: 'neutral-result-sentinel',
        },
      },
      {
        toolName: 'create_code_task',
        status: 'completed',
        argsSummary: {
          mode: 'private.person@example.com',
          start: '/Users/private/secret',
          end: 'neutral-string-sentinel',
          timeMin: 'https://private.example/time',
          timeMax: '2026-07-18',
          timeZone: 'private.person@example.com',
          workerType: '/Users/private/worker',
          taskMode: 'neutral-task-mode',
          maxResults: Number.POSITIVE_INFINITY,
          queryLength: -1,
          hasCalendarId: 'true',
          syntheticMarkerCount: 1.5,
          syntheticMarkerDigest: 'private-digest-sentinel',
          neutralKey: true,
        },
        resultSummary: {
          status: 'private.person@example.com',
          mode: '/Users/private/result',
          count: Number.POSITIVE_INFINITY,
          currentVersion: -1,
          hasEventId: 'true',
          neutralResult: 'neutral-result-sentinel',
        },
      },
    ]);

    expect(sanitized).toEqual([
      {
        toolName: 'create_calendar_event',
        status: 'completed',
        argsSummary: {
          mode: 'count',
          start: '2026-07-18T10:00:00+02:00',
          end: '2026-07-18T11:00:00+02:00',
          timeMin: '2026-07-18T00:00:00Z',
          timeMax: '2026-07-19T00:00:00Z',
          timeZone: 'Europe/Warsaw',
          workerType: 'minimax',
          taskMode: 'planning',
          maxResults: 10,
          queryLength: 33,
          hasCalendarId: true,
          syntheticMarkerCount: 1,
          syntheticMarkerDigest: digest,
        },
        resultSummary: {
          status: 'completed',
          mode: 'list',
          count: 0,
          currentVersion: 3,
          hasEventId: true,
          hasResourceUrl: false,
        },
      },
      {
        toolName: 'create_code_task',
        status: 'completed',
        argsSummary: {},
        resultSummary: {},
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(
      /neutral-string-sentinel|neutral-result-sentinel|private\.person@example\.com|\/Users\/private|private\.example|private-digest-sentinel/iu
    );

    const closedValues = sanitizeToolCalls(
      [
        { mode: 'list', workerType: 'codex', taskMode: 'planning' },
        { mode: 'count', workerType: 'codex-xhigh', taskMode: 'execution' },
        { workerType: 'minimax' },
      ].map((argsSummary) => ({
        toolName: 'create_code_task' as const,
        status: 'completed' as const,
        argsSummary,
      }))
    );
    expect(closedValues.map((call) => call.argsSummary)).toEqual([
      { mode: 'list', workerType: 'codex', taskMode: 'planning' },
      { mode: 'count', workerType: 'codex-xhigh', taskMode: 'execution' },
      { workerType: 'minimax' },
    ]);
  });

  it('sanitizes captured tool calls that have no optional summaries', () => {
    expect(sanitizeToolCalls([{ toolName: 'create_note', status: 'completed' }])).toEqual([
      { toolName: 'create_note', status: 'completed' },
    ]);
  });

  it('sanitizes sessions through an allowlisted DTO without summaries', () => {
    const sanitized = sanitizeSessions([
      {
        id: 'intex_session_1',
        userId: 'test-intex-agent-run',
        channel: 'whatsapp',
        status: 'completed',
        startedAt: '2026-07-01T10:00:00.000Z',
        endedAt: '2026-07-01T10:05:00.000Z',
        lastUserMessageAt: '2026-07-01T10:00:00.000Z',
        lastAssistantMessageAt: '2026-07-01T10:05:00.000Z',
        startReason: 'no_active_session',
        endReason: 'tool_completed',
        activeTool: 'create_note',
        summary: 'private summary with token abc',
      },
    ]);

    expect(sanitized).toEqual([
      {
        id: 'intex_session_1',
        userId: 'test-intex-agent-run',
        channel: 'whatsapp',
        status: 'completed',
        startedAt: '2026-07-01T10:00:00.000Z',
        endedAt: '2026-07-01T10:05:00.000Z',
        lastUserMessageAt: '2026-07-01T10:00:00.000Z',
        lastAssistantMessageAt: '2026-07-01T10:05:00.000Z',
        startReason: 'no_active_session',
        endReason: 'tool_completed',
        activeTool: 'create_note',
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('private summary');
    expect(JSON.stringify(sanitized)).not.toContain('token abc');
  });

  it('sanitizes sessions that have no optional timestamp or tool fields', () => {
    expect(
      sanitizeSessions([
        {
          id: 'intex_session_2',
          userId: 'test-intex-agent-run',
          channel: 'whatsapp',
          status: 'active',
          startedAt: '2026-07-01T10:00:00.000Z',
          lastUserMessageAt: '2026-07-01T10:00:00.000Z',
          startReason: 'no_active_session',
        },
      ])
    ).toEqual([
      {
        id: 'intex_session_2',
        userId: 'test-intex-agent-run',
        channel: 'whatsapp',
        status: 'active',
        startedAt: '2026-07-01T10:00:00.000Z',
        lastUserMessageAt: '2026-07-01T10:00:00.000Z',
        startReason: 'no_active_session',
      },
    ]);
  });

  it('closes errors and summarizes arrays without leaking unsupported values', () => {
    const sanitizedCalls = sanitizeToolCalls([
      {
        toolName: 'create_note',
        status: 'failed',
        argsSummary: { tags: ['private', 'labels'], authToken: 'secret-token' },
        error: 'delivery failed for private.person@example.com; secret=sk-private-value',
      },
    ]);
    const record = sanitizeRecord({
      visible: '  hello   world  ',
      list: ['a', 'b', 'c'],
      nested: { secretKey: 'hidden', count: 2 },
      unsupported: Symbol('unsupported'),
    });

    expect(sanitizedCalls[0]?.error).toBe('tool_execution_failed');
    expect(JSON.stringify(sanitizedCalls)).not.toMatch(
      /private\.person@example\.com|sk-private-value/iu
    );
    expect(JSON.stringify(sanitizedCalls)).not.toContain('secret-token');
    expect(record).toEqual({
      visible: 'hello world',
      list: { count: 3 },
      nested: { count: 2 },
    });
  });

  it('omits strings that normalize to empty values', () => {
    expect(sanitizeRecord({ textPreview: ' \n\t ', reason: 'kept' })).toEqual({ reason: 'kept' });
  });

  it('omits event payload strings that normalize to empty values', () => {
    const sanitized = sanitizeEventsBySessionId({
      intex_session_1: [
        {
          id: 'event-1',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'user_message',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: { text: ' \n\t ', sourceType: ' \r\n ' },
        },
      ],
    });

    expect(sanitized).toEqual({
      intex_session_1: [
        {
          id: 'event-1',
          type: 'user_message',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: {},
        },
      ],
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
        message: 'Czy wykonać? Prompt: [redacted] Źródło: [redacted]',
        replyToMessageId: 'wamid-1',
        correlationId: 'intex_session_1',
        ctaUrl: { displayText: 'Open [redacted-url]', url: '[redacted-url]' },
        buttons: [{ type: 'reply', reply: { id: 'intex_confirm:abc:yes', title: 'Tak' } }],
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('tajna preferencja');
    expect(JSON.stringify(sanitized)).not.toContain('https://signed.example/private');
    expect(JSON.stringify(sanitized)).not.toContain('OK');
  });

  it.each([
    {
      name: 'LF U+000A',
      separator: '\n',
      sentinelTag: 'lf',
    },
    {
      name: 'CRLF U+000D U+000A',
      separator: '\r\n',
      sentinelTag: 'crlf',
    },
    {
      name: 'CR U+000D',
      separator: '\r',
      sentinelTag: 'cr',
    },
    {
      name: 'VT U+000B',
      separator: '\u000B',
      sentinelTag: 'vt',
    },
    {
      name: 'FF U+000C',
      separator: '\u000C',
      sentinelTag: 'ff',
    },
    {
      name: 'NEL U+0085',
      separator: '\u0085',
      sentinelTag: 'nel',
    },
    {
      name: 'FS U+001C',
      separator: '\u001C',
      sentinelTag: 'fs',
    },
    {
      name: 'GS U+001D',
      separator: '\u001D',
      sentinelTag: 'gs',
    },
    {
      name: 'RS U+001E',
      separator: '\u001E',
      sentinelTag: 'rs',
    },
    {
      name: 'US U+001F',
      separator: '\u001F',
      sentinelTag: 'us',
    },
    {
      name: 'LS U+2028',
      separator: '\u2028',
      sentinelTag: 'ls',
    },
    {
      name: 'PS U+2029',
      separator: '\u2029',
      sentinelTag: 'ps',
    },
  ])(
    'collapses every $name Content continuation into the field redaction without mutating the captured reply',
    ({ separator, sentinelTag }) => {
      const continuationSentinel = `private-${sentinelTag}-continuation-z7q4`;
      const trailingSentinel = `private-${sentinelTag}-trailing-v2m8`;
      const rawMessage = [
        'Add this note?',
        'Content: private-content-first-line',
        continuationSentinel,
        trailingSentinel,
      ].join(separator);
      const rawReply = capturedReply(rawMessage);
      const rawReplyBeforeSanitization = { ...rawReply };
      const sanitizedReplies = sanitizeAssistantReplies([rawReply]);
      const turns: TestConversationTurnResult[] = [
        {
          turnIndex: 0,
          kind: 'message',
          messageId: 'wamid-1',
          sessionId: 'intex_session_1',
          ...emptyTurnEvidence('intex_session_1'),
          assistantReplies: sanitizedReplies,
        },
      ];
      const transcript = buildBehavioralTranscript({
        turns,
        sessionTransitions: [
          { turnIndex: 0, action: 'started', sessionId: 'intex_session_1' },
        ],
        eventsBySessionId: {},
        toolCalls: [],
      });

      expect(sanitizedReplies[0]?.message).toBe('Add this note? Content: [redacted]');
      expect(transcript.turns[0]?.assistantReplyPreviews).toEqual([
        'Add this note? Content: [redacted]',
      ]);
      const sanitizedEvidence = JSON.stringify({
        sanitizedReplies,
        assistantReplyPreviews: transcript.turns[0]?.assistantReplyPreviews,
      });
      expect(sanitizedEvidence).not.toContain(continuationSentinel);
      expect(sanitizedEvidence).not.toContain(trailingSentinel);
      expect(rawReply).toEqual(rawReplyBeforeSanitization);
      expect(rawReply.message).toBe(rawMessage);
    }
  );

  it('redacts Prompt continuations and every following structured field', () => {
    const promptContinuationSentinel = 'private-prompt-continuation-k3r9';
    const modeSentinel = 'private-mode-field-h8w2';
    const workerSentinel = 'private-worker-field-d4n6';
    const sanitized = sanitizeAssistantReplies([
      capturedReply(
        [
          'Create this code task?',
          'Prompt: private-prompt-first-line',
          promptContinuationSentinel,
          `Mode: ${modeSentinel}`,
          `Worker: ${workerSentinel}`,
        ].join('\n')
      ),
    ]);

    expect(sanitized[0]?.message).toBe(
      'Create this code task? Prompt: [redacted] Mode: [redacted] Worker: [redacted]'
    );
    expect(JSON.stringify(sanitized)).not.toMatch(
      /private-(?:prompt-continuation-k3r9|mode-field-h8w2|worker-field-d4n6)/u
    );
  });

  it('redacts every canonical Polish code-task and preference confirmation label', () => {
    const sanitized = sanitizeAssistantReplies([
      capturedReply(
        [
          'Czy utworzyć zadanie programistyczne?',
          'Polecenie: private-polish-command-a7k2',
          'Tryb: private-polish-mode-b8m3',
          'Typ workera: private-polish-worker-c9n4',
          'Linear: private-linear-d1p5',
        ].join('\n')
      ),
      capturedReply(
        [
          'Czy zmodyfikować wpis w pamięci instrukcji?',
          'Wcześniej: private-before-e2q6',
          'Po zmianie: private-after-f3r7',
        ].join('\n')
      ),
    ]);

    expect(sanitized.map((reply) => reply.message)).toEqual([
      'Czy utworzyć zadanie programistyczne? Polecenie: [redacted] Tryb: [redacted] Typ workera: [redacted] Linear: [redacted]',
      'Czy zmodyfikować wpis w pamięci instrukcji? Wcześniej: [redacted] Po zmianie: [redacted]',
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(/private-/u);
  });

  it.each([
    { rawLabel: 'Content：', expectedLabel: 'Content' },
    { rawLabel: 'Ｃｏｎｔｅｎｔ:', expectedLabel: 'Content' },
    { rawLabel: 'Treść:', expectedLabel: 'Treść' },
    { rawLabel: '*Content:*', expectedLabel: 'Content' },
    { rawLabel: '- Content:', expectedLabel: 'Content' },
    { rawLabel: 'Con\u200Btent:', expectedLabel: 'Content' },
    { rawLabel: 'Content\u2060:', expectedLabel: 'Content' },
    { rawLabel: 'Content\u200E:', expectedLabel: 'Content' },
    { rawLabel: '> Content:', expectedLabel: 'Content' },
    { rawLabel: '• Content:', expectedLabel: 'Content' },
  ])(
    'normalizes and redacts decorated sensitive label $rawLabel',
    ({ rawLabel, expectedLabel }) => {
      const sentinel = 'private-normalized-label-v4s8';
      const sanitized = sanitizeAssistantReplies([
        capturedReply(`Confirm?\n${rawLabel} ${sentinel}`),
      ]);

      expect(sanitized[0]?.message).toBe(`Confirm? ${expectedLabel}: [redacted]`);
      expect(JSON.stringify(sanitized)).not.toContain(sentinel);
    }
  );

  it('redacts continuations after localized and additional sensitive fields', () => {
    const polishContinuationSentinel = 'private-polish-continuation-f5t1';
    const locationContinuationSentinel = 'private-location-continuation-p9c3';
    const sanitized = sanitizeAssistantReplies([
      capturedReply(
        [
          'Czy dodać notatkę?',
          'Treść: prywatna pierwsza linia',
          polishContinuationSentinel,
          'Miejsce: prywatna lokalizacja',
          locationContinuationSentinel,
        ].join('\n')
      ),
    ]);

    expect(sanitized[0]?.message).toBe(
      'Czy dodać notatkę? Treść: [redacted] Miejsce: [redacted]'
    );
    expect(JSON.stringify(sanitized)).not.toMatch(
      /private-(?:polish-continuation-f5t1|location-continuation-p9c3)/u
    );
  });

  it('collapses arbitrarily many sensitive continuations while preserving later field labels', () => {
    const privateContinuations = Array.from(
      { length: 18 },
      (_, index) => `private-content-continuation-${String(index + 1)}-q7m2`
    );
    const rawMessage = [
      'Add this note?',
      'Title: private-title-a4k8',
      'Content: private-content-first-line-b9p3',
      ...privateContinuations,
      'Location: private-location-c6t1',
      'private-location-continuation-d2w5',
      'Attendees: private-attendees-e8n4',
    ].join('\n');

    const sanitized = sanitizeAssistantReplies([capturedReply(rawMessage)]);

    expect(sanitized[0]?.message).toBe(
      'Add this note? Title: [redacted] Content: [redacted] Location: [redacted] Attendees: [redacted]'
    );
    expect(JSON.stringify(sanitized)).not.toMatch(/private-/u);
  });

  it('preserves ordinary non-sensitive multiline assistant replies', () => {
    const visibleSentinel = 'ordinary-visible-multiline-r6b2';
    const sanitized = sanitizeAssistantReplies([
      capturedReply(['First ordinary line.', visibleSentinel, 'Last ordinary line.'].join('\n')),
    ]);

    expect(sanitized[0]?.message).toBe(
      `First ordinary line. ${visibleSentinel} Last ordinary line.`
    );
  });

  it('redacts all structured confirmation fields that can carry synthetic markers', () => {
    const message = [
      'Add this calendar event?',
      'Title: Dentist INTEX-EVAL-002-F01',
      'Start: 2026-08-18T14:30:00+02:00',
      'End: 2026-08-18T15:15:00+02:00',
      'Location: Smile Clinic INTEX-EVAL-002-F02',
    ].join('\n');

    const sanitizedReply = sanitizeAssistantReplies([
      {
        userId: 'test-intex-agent-run',
        message,
        replyToMessageId: 'wamid-1',
        correlationId: 'intex_session_1',
      },
    ]);
    const sanitizedEvent = sanitizeEventsBySessionId({
      intex_session_1: [
        {
          id: 'event-1',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'confirmation_requested',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: {
            toolName: 'create_calendar_event',
            message,
            toolArgs: {
              summary: 'Dentist INTEX-EVAL-002-F01',
              start: '2026-08-18T14:30:00+02:00',
              end: '2026-08-18T15:15:00+02:00',
              location: 'Smile Clinic INTEX-EVAL-002-F02',
            },
          },
        },
      ],
    });

    expect(sanitizedReply[0]?.message).toBe(
      'Add this calendar event? Title: [redacted] Start: [redacted] End: [redacted] Location: [redacted] [date-presentation: raw-record]'
    );
    expect(sanitizedEvent['intex_session_1']?.[0]?.payload['textPreview']).toBe(
      'Add this calendar event? Title: [redacted] Start: [redacted] End: [redacted] Location: [redacted] [date-presentation: raw-record]'
    );
    expect(JSON.stringify([sanitizedReply, sanitizedEvent])).not.toContain('INTEX-EVAL');
  });

  it('keeps synthetic marker tokens out of generic assistant and event previews', () => {
    const sanitizedReply = sanitizeAssistantReplies([
      {
        userId: 'test-intex-agent-run',
        message: 'Please confirm INTEX-EVAL-001-F01.',
        replyToMessageId: 'wamid-1',
        correlationId: 'intex_session_1',
      },
    ]);
    const sanitizedEvent = sanitizeEventsBySessionId({
      intex_session_1: [
        {
          id: 'event-1',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'user_message',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: { text: 'Save INTEX-EVAL-001 INTEX-EVAL-001-F01.' },
        },
      ],
    });

    expect(sanitizedReply[0]?.message).toBe('Please confirm [synthetic-marker].');
    expect(sanitizedEvent['intex_session_1']?.[0]?.payload['textPreview']).toBe(
      'Save [synthetic-marker] [synthetic-marker].'
    );
    expect(JSON.stringify([sanitizedReply, sanitizedEvent])).not.toContain('INTEX-EVAL');
  });

  it('bounds normalized assistant replies without retaining the truncated suffix', () => {
    const truncatedSuffix = 'private-truncated-suffix-sentinel';
    const sanitized = sanitizeAssistantReplies([
      {
        userId: 'test-intex-agent-run',
        message: `Safe prefix ${'x'.repeat(4100)} ${truncatedSuffix}`,
        replyToMessageId: 'wamid-long',
        correlationId: 'intex_session_long',
      },
    ]);

    expect(sanitized[0]?.message).toHaveLength(4000);
    expect(sanitized[0]?.message.endsWith('...')).toBe(true);
    expect(sanitized[0]?.message).not.toContain(truncatedSuffix);
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
      'Here are the preferences. User Preferences: [redacted] [redacted-preference-item] [redacted-preference-item] [redacted-preference-item]'
    );
    expect(sanitized[1]?.message).toBe(
      'User Preferences: [redacted] [redacted-preference-item] Normal line.'
    );
    expect(JSON.stringify(sanitized)).not.toContain('tajne haslo');
    expect(JSON.stringify(sanitized)).not.toContain('private tone');
    expect(JSON.stringify(sanitized)).not.toContain('hidden value');
  });

  it('covers sensitive continuations and every preference-block exit without exposing content', () => {
    const sanitized = sanitizeAssistantReplies([
      capturedReply(
        [
          'Title: private-title',
          'private continuation',
          'Content: private-content',
        ].join('\n')
      ),
      capturedReply(
        [
          'User Preferences v5',
          '1. private numbered item',
          '',
          'Ordinary visible line.',
        ].join('\n')
      ),
      capturedReply(
        [
          'User Preferences v6',
          'Ordinary-looking private continuation without a list marker',
        ].join('\n')
      ),
    ]);

    expect(sanitized.map((reply) => reply.message)).toEqual([
      'Title: [redacted] Content: [redacted]',
      'User Preferences: [redacted] [redacted-preference-item] Ordinary visible line.',
      'User Preferences: [redacted] [redacted-preference-item]',
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(
      /private-title|private continuation|private-content|private numbered item/u
    );
  });

  it('keeps event-preview preference continuations redacted until a blank line', () => {
    const sanitized = sanitizeEventsBySessionId({
      intex_session_1: [
        {
          id: 'event-preferences',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'user_message',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: {
            text: [
              'User Preferences v7',
              'private continuation without a list marker',
              '',
              'Ordinary visible line.',
            ].join('\n'),
          },
        },
      ],
    });

    expect(sanitized['intex_session_1']?.[0]?.payload['textPreview']).toBe(
      'User Preferences: [redacted] [redacted-preference-item] Ordinary visible line.'
    );
    expect(JSON.stringify(sanitized)).not.toContain(
      'private continuation without a list marker'
    );
  });

  it('keeps event-preview sensitive-field continuations redacted', () => {
    const sanitized = sanitizeEventsBySessionId({
      intex_session_1: [
        {
          id: 'event-sensitive-details',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'user_message',
          createdAt: '2026-07-01T10:00:00.000Z',
          payload: {
            text: [
              'Title: private title',
              'private continuation',
              'Content: private content',
            ].join('\n'),
          },
        },
      ],
    });

    expect(sanitized['intex_session_1']?.[0]?.payload['textPreview']).toBe(
      'Title: [redacted] Content: [redacted]'
    );
    expect(JSON.stringify(sanitized)).not.toMatch(
      /private title|private continuation|private content/u
    );
  });

  it('uses the closed result summary for completed timeline events', () => {
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
              mode: 'list',
              count: 1,
              codeTaskId: 'private.person@example.com',
              resourceUrl: '/Users/private/secret',
              neutralResult: 'neutral-result-sentinel',
              token: 'secret-token',
              events: [{ private: true }],
            },
          },
        },
        {
          id: 'event-2',
          sessionId: 'intex_session_1',
          userId: 'test-intex-agent-run',
          type: 'tool_call_completed',
          createdAt: '2026-07-01T10:00:01.000Z',
          payload: {
            toolName: 'create_code_task',
            result: {
              status: 'private.person@example.com',
              mode: '/Users/private/result',
              count: 2,
              eventId: 'neutral-event-id-sentinel',
            },
          },
        },
      ],
    });

    expect(sanitized['intex_session_1']?.[0]?.payload).toEqual({
      toolName: 'create_code_task',
      resultSummary: {
        status: 'completed',
        mode: 'list',
        count: 1,
        hasCodeTaskId: true,
        hasResourceUrl: true,
      },
    });
    expect(sanitized['intex_session_1']?.[1]?.payload).toEqual({
      toolName: 'create_code_task',
      resultSummary: { count: 2, hasEventId: true },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(
      /secret-token|private\.person@example\.com|\/Users\/private|neutral-result-sentinel|neutral-event-id-sentinel/iu
    );
  });

  it('builds a normalized behavioral transcript from turns, events, transitions, and tool calls', () => {
    const turns: TestConversationTurnResult[] = [
      {
        turnIndex: 0,
        kind: 'message',
        messageId: 'wamid-1',
        sessionId: 'intex_session_1',
        ...emptyTurnEvidence('intex_session_1'),
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
        ...emptyTurnEvidence('intex_session_1'),
        assistantReplies: [],
      },
      {
        turnIndex: 1,
        kind: 'message',
        messageId: 'wamid-2',
        sessionId: 'intex_session_2',
        ...emptyTurnEvidence('intex_session_2'),
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
        ...emptyTurnEvidence('intex_session_1'),
        assistantReplies: [{ userId: 'u', message: 'first', replyToMessageId: 'wamid-1', correlationId: 's' }],
      },
      {
        turnIndex: 1,
        kind: 'message',
        messageId: 'wamid-2',
        sessionId: 'intex_session_1',
        ...emptyTurnEvidence('intex_session_1'),
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
          ...emptyTurnEvidence('intex_session_1'),
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

function markerDigest(markers: readonly string[]): string {
  return createHash('sha256')
    .update(`intex-eval-marker-set:v1\0${[...markers].sort().join('\n')}`, 'utf8')
    .digest('hex');
}

function emptyTurnEvidence(
  sessionId: string
): Pick<TestConversationTurnResult, 'toolCalls' | 'sessionAfterTurn' | 'timelineEvents'> {
  return {
    toolCalls: [],
    sessionAfterTurn: {
      id: sessionId,
      status: 'waiting_for_user',
      startReason: 'no_active_session',
    },
    timelineEvents: [],
  };
}

function capturedReply(message: string): CapturedAssistantReply {
  return {
    userId: 'test-intex-agent-run',
    message,
    replyToMessageId: 'wamid-1',
    correlationId: 'intex_session_1',
  };
}
