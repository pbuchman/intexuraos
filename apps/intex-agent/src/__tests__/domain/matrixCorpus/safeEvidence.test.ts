import { describe, expect, it } from 'vitest';

import {
  mapSafeToolFacts,
  type SafeToolFactV1,
} from '../../../domain/matrixCorpus/safeEvidence.js';

const privateSentinels = [
  'raw-id-123',
  'https://secret.example/token?credential=hunter2',
  'contact+private@pbuchman.com',
  'CAPABILITY_PRIVATE',
  'PROMPT_PRIVATE',
  'REASONING_PRIVATE',
];

describe('mapSafeToolFacts', () => {
  it.each([
    {
      toolName: 'create_note' as const,
      source: 'arguments' as const,
      value: {
        content: 'secret body',
        title: 'title',
        tags: ['one', 'two'],
        sourceMessageIds: ['raw-id-123'],
        unknown: privateSentinels,
      },
      expected: [
        fact('contentLength', 11),
        fact('titleLength', 5),
        fact('tagsCount', 2),
        fact('sourceMessageIdsCount', 1),
      ],
    },
    {
      toolName: 'create_calendar_event' as const,
      source: 'arguments' as const,
      value: {
        summary: 'Planning',
        start: '2026-07-20T10:00:00.000Z',
        end: '2026-07-20T11:00:00.000Z',
        timeZone: 'Europe/Warsaw',
        location: 'private room',
        description: 'private description',
        attendees: ['contact+private@pbuchman.com'],
      },
      expected: [
        fact('summaryLength', 8),
        fact('locationLength', 12),
        fact('descriptionLength', 19),
        fact('attendeesCount', 1),
        fact('startMatchesCatalog', true),
        fact('endMatchesCatalog', true),
        fact('timeZoneMatchesCatalog', true),
      ],
      catalog: {
        start: '2026-07-20T10:00:00.000Z',
        end: '2026-07-20T11:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      },
    },
    {
      toolName: 'update_calendar_event' as const,
      source: 'arguments' as const,
      value: {
        eventId: 'raw-id-123',
        eventSummary: 'Planning',
        attendeesToAdd: ['contact+private@pbuchman.com'],
        calendarId: 'raw-id-123',
        expectedEtag: 'private-etag',
        eventStart: { dateTime: '2026-07-20T10:00:00.000Z' },
        eventEnd: { dateTime: '2026-07-20T11:00:00.000Z' },
      },
      expected: [
        fact('summaryLength', 8),
        fact('attendeesCount', 1),
        fact('hasCalendarId', true),
        fact('hasExpectedEtag', true),
        fact('hasEventStart', true),
        fact('hasEventEnd', true),
      ],
    },
    {
      toolName: 'query_calendar_events' as const,
      source: 'arguments' as const,
      value: {
        mode: 'list',
        timeMin: '2026-07-20T10:00:00.000Z',
        timeMax: '2026-07-20T11:00:00.000Z',
        query: 'private query',
        calendarId: 'raw-id-123',
        maxResults: 20,
      },
      expected: [
        fact('queryLength', 13),
        fact('maxResults', 20),
        fact('hasCalendarId', true),
        fact('startMatchesCatalog', true),
        fact('endMatchesCatalog', true),
        fact('mode', 'list'),
      ],
      catalog: {
        start: '2026-07-20T10:00:00.000Z',
        end: '2026-07-20T11:00:00.000Z',
      },
    },
    {
      toolName: 'create_research' as const,
      source: 'arguments' as const,
      value: {
        title: 'Research',
        prompt: 'PROMPT_PRIVATE',
        originalMessage: 'private original',
        sourceMessageIds: ['raw-id-123'],
      },
      expected: [
        fact('titleLength', 8),
        fact('promptLength', 14),
        fact('originalMessageLength', 16),
        fact('sourceMessageIdsCount', 1),
      ],
    },
    {
      toolName: 'create_link' as const,
      source: 'arguments' as const,
      value: {
        url: 'https://secret.example/token?credential=hunter2',
        title: 'Private title',
        description: 'Private description',
        tags: ['one'],
        sourceMessageIds: ['raw-id-123'],
      },
      expected: [
        fact('titleLength', 13),
        fact('descriptionLength', 19),
        fact('tagsCount', 1),
        fact('sourceMessageIdsCount', 1),
        fact('hasUrl', true),
      ],
    },
    {
      toolName: 'create_code_task' as const,
      source: 'arguments' as const,
      value: {
        prompt: 'PROMPT_PRIVATE',
        workerType: 'codex-xhigh',
        linearIssueId: 'raw-id-123',
        taskMode: 'execution',
        reasoning: 'REASONING_PRIVATE',
      },
      expected: [
        fact('promptLength', 14),
        fact('hasLinearIssueId', true),
        fact('workerType', 'codex-xhigh'),
        fact('taskMode', 'execution'),
      ],
    },
    {
      toolName: 'save_external' as const,
      source: 'arguments' as const,
      value: {
        message: 'private message',
        sourceUrl: 'https://secret.example/token?credential=hunter2',
      },
      expected: [fact('messageLength', 15), fact('hasSourceUrl', true)],
    },
    {
      toolName: 'get_user_preferences' as const,
      source: 'result' as const,
      value: {
        currentVersion: 7,
        items: [{ id: 'raw-id-123', text: 'private preference' }],
      },
      expected: [fact('resultCount', 1), fact('currentVersion', 7)],
    },
    {
      toolName: 'add_user_preference' as const,
      source: 'arguments' as const,
      value: { text: 'private preference', expectedVersion: 6 },
      expected: [fact('textLength', 18), fact('expectedVersion', 6)],
    },
    {
      toolName: 'update_user_preference' as const,
      source: 'arguments' as const,
      value: { itemId: 'raw-id-123', text: 'private preference', expectedVersion: 6 },
      expected: [
        fact('textLength', 18),
        fact('expectedVersion', 6),
        fact('hasItemId', true),
      ],
    },
    {
      toolName: 'delete_user_preference' as const,
      source: 'arguments' as const,
      value: { itemId: 'raw-id-123', expectedVersion: 6 },
      expected: [fact('expectedVersion', 6), fact('hasItemId', true)],
    },
  ])('maps closed $source facts for $toolName', ({ toolName, source, value, expected, catalog }) => {
    const facts = mapSafeToolFacts({ toolName, source, value, ...(catalog ? { catalog } : {}) });

    expect(facts).toEqual(expected);
    const serialized = JSON.stringify(facts);
    for (const sentinel of privateSentinels) expect(serialized).not.toContain(sentinel);
  });

  it('maps only closed result summaries and drops raw IDs, URLs, objects, and unknown fields', () => {
    const facts = mapSafeToolFacts({
      toolName: 'create_link',
      source: 'result',
      value: {
        bookmarkId: 'raw-id-123',
        resourceUrl: 'https://secret.example/token?credential=hunter2',
        title: 'Safe only as a length',
        nested: { prompt: 'PROMPT_PRIVATE' },
        reasoning: 'REASONING_PRIVATE',
      },
    });

    expect(facts).toEqual([fact('titleLength', 21), fact('hasUrl', true)]);
    expect(Object.keys(facts[0] ?? {})).toEqual(['name', 'value']);
  });

  it('returns no facts for malformed/object-shaped scalar fields or unknown source fields', () => {
    expect(
      mapSafeToolFacts({
        toolName: 'create_code_task',
        source: 'arguments',
        value: {
          prompt: { secret: 'PROMPT_PRIVATE' },
          workerType: 'unknown-worker',
          taskMode: ['execution'],
          linearIssueId: {},
          unknown: privateSentinels,
        },
      })
    ).toEqual([]);
  });

  it.each([
    ['create_note', { message: 'Done' }, [fact('messageLength', 4)]],
    ['create_research', { message: 'Ready' }, [fact('messageLength', 5)]],
    ['save_external', { message: 'Saved' }, [fact('messageLength', 5)]],
    ['create_calendar_event', { summary: 'Meeting' }, [fact('summaryLength', 7)]],
    [
      'query_calendar_events',
      { count: 2, mode: 'count' },
      [fact('resultCount', 2), fact('mode', 'count')],
    ],
    ['create_code_task', { taskId: 'private' }, []],
    ['add_user_preference', { currentVersion: 3 }, [fact('currentVersion', 3)]],
    ['update_user_preference', { currentVersion: 4 }, [fact('currentVersion', 4)]],
    ['delete_user_preference', { currentVersion: 5 }, [fact('currentVersion', 5)]],
  ] as const)('maps the closed result allowlist for %s', (toolName, value, expected) => {
    expect(
      mapSafeToolFacts({ toolName, source: 'result', value: value as Record<string, unknown> })
    ).toEqual(expected);
  });

  it('returns no facts for preference reads and non-record source values', () => {
    expect(
      mapSafeToolFacts({ toolName: 'get_user_preferences', source: 'arguments', value: {} })
    ).toEqual([]);
    for (const value of [null, 'private', 3, true, []])
      expect(mapSafeToolFacts({ toolName: 'create_note', source: 'arguments', value })).toEqual([]);
  });

  it('emits explicit false match and presence facts without copying source values', () => {
    expect(
      mapSafeToolFacts({
        toolName: 'create_calendar_event',
        source: 'arguments',
        value: {
          start: 'different',
          end: 'different',
          timeZone: 'UTC',
        },
        catalog: {
          start: 'expected',
          end: 'expected',
          timeZone: 'Europe/Warsaw',
        },
      })
    ).toEqual([
      fact('startMatchesCatalog', false),
      fact('endMatchesCatalog', false),
      fact('timeZoneMatchesCatalog', false),
    ]);
    expect(
      mapSafeToolFacts({
        toolName: 'query_calendar_events',
        source: 'arguments',
        value: { calendarId: '', maxResults: -1, mode: 'private' },
      })
    ).toEqual([fact('hasCalendarId', false)]);
  });

  it.each([
    ['create_note', { content: 1, title: null, tags: {}, sourceMessageIds: 'private' }],
    [
      'create_calendar_event',
      { summary: 1, location: null, description: [], attendees: {}, start: 1, end: 1, timeZone: 1 },
    ],
    [
      'update_calendar_event',
      { eventSummary: 1, attendeesToAdd: {}, calendarId: {}, expectedEtag: 1 },
    ],
    [
      'query_calendar_events',
      { query: 1, maxResults: 1.5, calendarId: {}, timeMin: 1, timeMax: 1, mode: 'private' },
    ],
    ['create_research', { title: 1, prompt: {}, originalMessage: [], sourceMessageIds: {} }],
    ['create_link', { title: 1, description: {}, tags: 'private', sourceMessageIds: {}, url: 1 }],
    ['save_external', { message: 1, sourceUrl: {} }],
    ['add_user_preference', { text: {}, expectedVersion: -1 }],
    ['update_user_preference', { text: {}, expectedVersion: 1.5, itemId: {} }],
    ['delete_user_preference', { expectedVersion: -1, itemId: {} }],
  ] as const)('drops every malformed allowlisted argument for %s', (toolName, value) => {
    expect(
      mapSafeToolFacts({ toolName, source: 'arguments', value: value as Record<string, unknown> })
    ).toEqual([]);
  });
});

function fact(name: SafeToolFactV1['name'], value: SafeToolFactV1['value']): SafeToolFactV1 {
  return { name, value };
}
