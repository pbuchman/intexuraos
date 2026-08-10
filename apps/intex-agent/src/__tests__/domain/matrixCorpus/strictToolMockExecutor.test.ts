import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type IntexAgentToolNameV1,
  type StrictMockResultV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { IntexAgentToolExecutor } from '../../../domain/agent/toolDefinitions.js';
import {
  createStrictToolMockBoundary,
  createStrictToolMockExecutor,
  MatrixCorpusStrictToolMockError,
  type MatrixCorpusStrictPreferenceOverlay,
} from '../../../domain/matrixCorpus/strictToolMockExecutor.js';
import {
  decodeStrictToolMockProfile,
  type DecodedStrictToolMockProfile,
} from '../../../domain/matrixCorpus/strictToolMockProfile.js';

const toolCases = [
  ['create_note', 'createNote', [{ content: 'Secret is not recorded.' }]],
  [
    'create_calendar_event',
    'createCalendarEvent',
    [{ summary: 'Synthetic', start: '2026-07-20T10:00:00Z', end: '2026-07-20T11:00:00Z' }],
  ],
  [
    'update_calendar_event',
    'updateCalendarEvent',
    [
      {
        eventId: 'mock_event_1',
        eventSummary: 'Synthetic',
        attendeesToAdd: ['patryk@example.com'],
        calendarId: 'mock_calendar_1',
        expectedEtag: '"mock-event-1-v1"',
        eventStart: { dateTime: '2026-07-20T10:00:00Z' },
        eventEnd: { dateTime: '2026-07-20T11:00:00Z' },
      },
    ],
  ],
  [
    'query_calendar_events',
    'queryCalendarEvents',
    [{ mode: 'count', timeMin: '2026-07-20T00:00:00Z', timeMax: '2026-07-21T00:00:00Z' }],
  ],
  ['create_research', 'createResearch', [{ title: 'Synthetic', prompt: 'Synthetic' }]],
  ['create_link', 'createLink', [{ url: 'https://example.invalid/input' }]],
  ['create_code_task', 'createCodeTask', [{ prompt: 'Synthetic', taskMode: 'planning' }]],
  ['save_external', 'saveExternal', [{ message: 'Synthetic' }]],
] as const;

describe('strict Matrix corpus tool-mock executor', () => {
  it('shares one authorization between the runner gate and read-only mock execution', async () => {
    const expected: StrictMockResultV1 = {
      toolName: 'query_calendar_events',
      status: 'completed',
      mode: 'list',
      count: 1,
      truncated: true,
      events: [
        {
          eventId: 'mock_event_1',
          etag: '"mock-event-1-v1"',
          summary: 'Synthetic',
          start: { dateTime: '2026-07-20T10:00:00Z', timeZone: 'Europe/Warsaw' },
          end: { dateTime: '2026-07-20T11:00:00Z', timeZone: 'Europe/Warsaw' },
          status: 'confirmed',
          calendarId: 'mock_calendar_1',
        },
      ],
    };
    const recordToolCallStarted = vi.fn(async () => undefined);
    const boundary = createStrictToolMockBoundary({
      profile: decode(baseProfile({ calls: [successCall('query_calendar_events', 1, expected)] })),
      turnIndex: 0,
      ingestReceiptId: 'receipt_1',
      recordToolCallStarted,
    });
    const args = {
      mode: 'list' as const,
      timeMin: '2026-07-20T00:00:00Z',
      timeMax: '2026-07-21T00:00:00Z',
    };

    await expect(
      boundary.selectionGate({ toolName: 'query_calendar_events', args })
    ).resolves.toEqual({ decision: 'allow', metadata: { turnIndex: 0, ordinal: 1 } });
    const result = await boundary.executor.queryCalendarEvents(args);
    expect(JSON.parse(result)).toEqual(expected);
    expect(recordToolCallStarted).toHaveBeenCalledOnce();
  });

  it('returns a typed no-execution rejection from the runner gate', async () => {
    const boundary = createStrictToolMockBoundary({
      profile: decode(
        baseProfile({
          forbiddenSelections: [{ turnIndex: 0, toolName: 'create_note' }],
        })
      ),
      turnIndex: 0,
      ingestReceiptId: 'receipt_1',
      recordToolCallStarted: async () => undefined,
    });

    await expect(
      boundary.selectionGate({ toolName: 'create_note', args: { content: 'private' } })
    ).resolves.toEqual({
      decision: 'reject',
      category: 'behavioral_failure',
      code: 'FORBIDDEN_TOOL_SELECTED',
      metadata: { turnIndex: 0, ordinal: 1 },
    });
    await expect(boundary.executor.createNote({ content: 'private' })).rejects.toMatchObject({
      code: 'MISSING_PREAUTHORIZED_SELECTION',
    });
  });

  it.each(['calendarId', 'expectedEtag', 'eventStart', 'eventEnd'] as const)(
    'fails closed when a confirmed calendar update loses its %s snapshot field',
    async (missingField) => {
      const result = resultFor('update_calendar_event');
      const executor = executorFor([successCall('update_calendar_event', 1, result)]);
      const completeArgs = {
        eventId: 'mock_event_1',
        eventSummary: 'Synthetic',
        attendeesToAdd: ['patryk@example.com'],
        calendarId: 'mock_calendar_1',
        expectedEtag: '"mock-event-1-v1"',
        eventStart: { dateTime: '2026-07-20T10:00:00Z' },
        eventEnd: { dateTime: '2026-07-20T11:00:00Z' },
      };
      const incompleteArgs = Object.fromEntries(
        Object.entries(completeArgs).filter(([key]) => key !== missingField)
      ) as unknown as Parameters<typeof executor.updateCalendarEvent>[0];

      await expect(executor.updateCalendarEvent(incompleteArgs)).rejects.toMatchObject({
        category: 'safety_stop',
        code: 'MISSING_CALENDAR_EVENT_SNAPSHOT',
      });
    }
  );

  it('authorizes a mutating preview from the immediately following confirmation turn without recording execution', async () => {
    const result = resultFor('create_note');
    const profile = baseProfile({
      calls: [
        {
          ...successCall('create_note', 1, result),
          turnIndex: 1,
        },
      ],
      forbiddenSelections: [{ turnIndex: 0, toolName: 'create_note' }],
    });
    const recordToolCallStarted = vi.fn(async () => undefined);
    const boundary = createStrictToolMockBoundary({
      profile: decode(profile),
      turnIndex: 0,
      ingestReceiptId: 'receipt_preview',
      recordToolCallStarted,
      expectedByCatalog: ({ turnIndex, toolName, ordinal }) =>
        turnIndex === 1 && toolName === 'create_note' && ordinal === 1,
    });

    await expect(
      boundary.selectionGate({ toolName: 'create_note', args: { content: 'private' } })
    ).resolves.toEqual({ decision: 'allow', metadata: { turnIndex: 1, ordinal: 1 } });
    expect(recordToolCallStarted).not.toHaveBeenCalled();
  });

  it('rejects a mutating preview when the catalog does not authorize its next-turn call', async () => {
    const result = resultFor('create_note');
    const profile = baseProfile({
      calls: [{ ...successCall('create_note', 1, result), turnIndex: 1 }],
      forbiddenSelections: [{ turnIndex: 0, toolName: 'create_note' }],
    });
    const boundary = createStrictToolMockBoundary({
      profile: decode(profile),
      turnIndex: 0,
      ingestReceiptId: 'receipt_preview_rejected',
      recordToolCallStarted: vi.fn(async () => undefined),
      expectedByCatalog: () => false,
    });

    await expect(
      boundary.selectionGate({ toolName: 'create_note', args: { content: 'private' } })
    ).resolves.toEqual({
      decision: 'reject',
      category: 'behavioral_failure',
      code: 'FORBIDDEN_TOOL_SELECTED',
      metadata: { turnIndex: 0, ordinal: 1 },
    });
  });

  it.each(toolCases)('returns only the scheduled bounded result for %s', async (toolName, method, args) => {
    const expected = resultFor(toolName);
    const recordToolCallStarted = vi.fn(async () => undefined);
    const executor = executorFor([successCall(toolName, 1, expected)], {
      recordToolCallStarted,
    });

    const raw = await invoke(executor, method, args[0]);

    expect(JSON.parse(raw)).toEqual(expected);
    expect(recordToolCallStarted).toHaveBeenCalledWith({
      toolName,
      turnIndex: 0,
      ordinal: 1,
      facts: expect.any(Array),
    });
    expect(JSON.stringify(recordToolCallStarted.mock.calls)).not.toContain('Secret is not recorded.');
  });

  it('uses consecutive per-tool ordinals for repeated calls', async () => {
    const first = resultFor('create_note');
    const second = { ...first, message: 'Second synthetic result' };
    const recordedOrdinals: number[] = [];
    const recordToolCallStarted = vi.fn(async (selection: { ordinal: number }) => {
      recordedOrdinals.push(selection.ordinal);
    });
    const executor = executorFor(
      [successCall('create_note', 1, first), successCall('create_note', 2, second)],
      { recordToolCallStarted }
    );

    await expect(executor.createNote({ content: 'one' })).resolves.toBe(JSON.stringify(first));
    await expect(executor.createNote({ content: 'two' })).resolves.toBe(JSON.stringify(second));
    expect(recordedOrdinals).toEqual([1, 2]);
  });

  it('records selection before the policy gate and never executes forbidden selection', async () => {
    const order: string[] = [];
    const overlay = preferenceOverlay({ order });
    const profile = baseProfile({
      forbiddenSelections: [{ turnIndex: 0, toolName: 'get_user_preferences' }],
    });
    const executor = createStrictToolMockExecutor({
      profile: decode(profile),
      turnIndex: 0,
      ingestReceiptId: 'receipt_1',
      recordToolCallStarted: async () => {
        order.push('tool_call_started');
      },
      preferenceOverlay: overlay,
    });

    await expect(executor.getUserPreferences()).rejects.toMatchObject({
      name: 'MatrixCorpusStrictToolMockError',
      category: 'behavioral_failure',
      code: 'FORBIDDEN_TOOL_SELECTED',
    });
    expect(order).toEqual(['tool_call_started']);
    expect(overlay.read).not.toHaveBeenCalled();
    expect(overlay.mutate).not.toHaveBeenCalled();
  });

  it('stops safely when an expected catalog call is absent from the profile', async () => {
    const executor = executorFor([], {
      expectedByCatalog: () => true,
    });

    await expect(executor.createNote({ content: 'synthetic' })).rejects.toMatchObject({
      category: 'safety_stop',
      code: 'MISSING_EXPECTED_MOCK_CONFIGURATION',
    });
  });

  it('surfaces configured failures without inventing a default result', async () => {
    const executor = executorFor([
      {
        turnIndex: 0,
        toolName: 'create_note',
        ordinal: 1,
        outcome: { kind: 'failure', code: 'MOCK_TOOL_FAILURE' },
      },
    ]);

    await expect(executor.createNote({ content: 'synthetic' })).rejects.toEqual(
      expect.objectContaining({
        name: 'MatrixCorpusStrictToolMockError',
        category: 'configured_failure',
        code: 'MOCK_TOOL_FAILURE',
      })
    );
  });

  it('reads preferences only from the encrypted scenario overlay', async () => {
    const expected = resultFor('get_user_preferences');
    const overlay = preferenceOverlay({ readResult: expected });
    const executor = executorFor([successCall('get_user_preferences', 1, expected)], {
      preferenceOverlay: overlay,
    });

    await expect(executor.getUserPreferences()).resolves.toBe(JSON.stringify(expected));
    expect(overlay.read).toHaveBeenCalledWith({
      ingestReceiptId: 'receipt_1',
      toolName: 'get_user_preferences',
      turnIndex: 0,
      ordinal: 1,
      configuredResult: expected,
    });
    expect(overlay.mutate).not.toHaveBeenCalled();
  });

  it('returns the dynamic encrypted overlay snapshot instead of the fixed catalog placeholder', async () => {
    const configured = resultFor('get_user_preferences');
    const overlayResult: StrictMockResultV1 = {
      toolName: 'get_user_preferences',
      status: 'completed',
      currentVersion: 2,
      items: [{ id: 'mock_pref_existing', text: 'Use concise replies.' }],
    };
    const overlay = preferenceOverlay({ readResult: overlayResult });
    const executor = executorFor([successCall('get_user_preferences', 1, configured)], {
      preferenceOverlay: overlay,
    });

    await expect(executor.getUserPreferences()).resolves.toBe(JSON.stringify(overlayResult));
    expect(overlay.read).toHaveBeenCalledWith({
      ingestReceiptId: 'receipt_1',
      toolName: 'get_user_preferences',
      turnIndex: 0,
      ordinal: 1,
      configuredResult: configured,
    });
  });

  it.each([
    ['a different tool result', resultFor('create_note')],
    [
      'a malformed preference result',
      {
        toolName: 'get_user_preferences',
        status: 'completed',
        currentVersion: -1,
        items: [],
      } as unknown as StrictMockResultV1,
    ],
  ])('fails closed when the preference overlay returns %s', async (_label, readResult) => {
    const configured = resultFor('get_user_preferences');
    const overlay = preferenceOverlay({ readResult });
    const executor = executorFor([successCall('get_user_preferences', 1, configured)], {
      preferenceOverlay: overlay,
    });

    await expect(executor.getUserPreferences()).rejects.toMatchObject({
      category: 'safety_stop',
      code: 'PREFERENCE_OVERLAY_RESULT_MISMATCH',
    });
  });

  it('fails closed when a preference tool has no encrypted scenario overlay', async () => {
    const executor = executorFor([
      successCall('get_user_preferences', 1, resultFor('get_user_preferences')),
    ]);

    await expect(executor.getUserPreferences()).rejects.toMatchObject({
      category: 'safety_stop',
      code: 'MISSING_PREFERENCE_OVERLAY',
    });
  });

  it.each([
    ['add_user_preference', 'addUserPreference', { text: 'Short replies', expectedVersion: 0 }],
    [
      'update_user_preference',
      'updateUserPreference',
      { itemId: 'mock_pref_1', text: 'Very short replies', expectedVersion: 0 },
    ],
    [
      'delete_user_preference',
      'deleteUserPreference',
      { itemId: 'mock_pref_1', expectedVersion: 0 },
    ],
  ] as const)(
    'binds %s overlay mutations to receipt, tool, turn, and ordinal',
    async (toolName, method, args) => {
      const expected = resultFor(toolName);
      const overlay = preferenceOverlay({ mutateResult: expected });
      const executor = executorFor([successCall(toolName, 1, expected)], {
        preferenceOverlay: overlay,
      });

      await expect(invoke(executor, method, args)).resolves.toBe(JSON.stringify(expected));
      expect(overlay.mutate).toHaveBeenCalledWith({
        ingestReceiptId: 'receipt_1',
        mutationReceipt: expect.stringMatching(/^[0-9a-f]{64}$/u),
        toolName,
        turnIndex: 0,
        ordinal: 1,
        args,
        configuredResult: expected,
      });
      expect(overlay.read).not.toHaveBeenCalled();
    }
  );

  it('rejects an overlay response that differs from the immutable schedule', async () => {
    const expected = resultFor('add_user_preference') as Extract<
      StrictMockResultV1,
      { toolName: 'add_user_preference' }
    >;
    const overlay = preferenceOverlay({
      mutateResult: { ...expected, currentVersion: 2 },
    });
    const executor = executorFor([successCall('add_user_preference', 1, expected)], {
      preferenceOverlay: overlay,
    });

    await expect(
      executor.addUserPreference({ text: 'Short replies', expectedVersion: 0 })
    ).rejects.toMatchObject({
      category: 'safety_stop',
      code: 'PREFERENCE_OVERLAY_RESULT_MISMATCH',
    });
  });

  it('fails closed when a mutation overlay returns a non-object result', async () => {
    const expected = resultFor('add_user_preference');
    const overlay = preferenceOverlay({
      mutateResult: [] as unknown as StrictMockResultV1,
    });
    const executor = executorFor([successCall('add_user_preference', 1, expected)], {
      preferenceOverlay: overlay,
    });

    await expect(
      executor.addUserPreference({ text: 'Short replies', expectedVersion: 0 })
    ).rejects.toMatchObject({
      category: 'safety_stop',
      code: 'PREFERENCE_OVERLAY_RESULT_MISMATCH',
    });
  });

  it('exposes a typed error boundary for orchestration without leaking arguments', () => {
    const error = new MatrixCorpusStrictToolMockError(
      'safety_stop',
      'MISSING_PREFERENCE_OVERLAY'
    );
    expect(error.message).toBe('Matrix corpus strict mock stopped: MISSING_PREFERENCE_OVERLAY');
    expect(error).not.toHaveProperty('args');
  });
});

function executorFor(
  calls: StrictToolMockProfileV1['calls'],
  overrides: Partial<Parameters<typeof createStrictToolMockExecutor>[0]> = {}
): IntexAgentToolExecutor {
  return createStrictToolMockExecutor({
    profile: decode(baseProfile({ calls })),
    turnIndex: 0,
    ingestReceiptId: 'receipt_1',
    recordToolCallStarted: async () => undefined,
    ...overrides,
  });
}

function preferenceOverlay(input: {
  readResult?: StrictMockResultV1;
  mutateResult?: StrictMockResultV1;
  order?: string[];
}): MatrixCorpusStrictPreferenceOverlay & {
  read: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(async (request: { configuredResult: StrictMockResultV1 }) => {
      input.order?.push('overlay_read');
      return input.readResult ?? request.configuredResult;
    }),
    mutate: vi.fn(async (request: { configuredResult: StrictMockResultV1 }) => {
      input.order?.push('overlay_mutate');
      return input.mutateResult ?? request.configuredResult;
    }),
  };
}

async function invoke(
  executor: IntexAgentToolExecutor,
  method: keyof IntexAgentToolExecutor,
  args: unknown
): Promise<string> {
  const callable = executor[method] as (input: never) => Promise<string>;
  return await callable(args as never);
}

function successCall(
  toolName: IntexAgentToolNameV1,
  ordinal: number,
  result: StrictMockResultV1
): StrictToolMockProfileV1['calls'][number] {
  return {
    turnIndex: 0,
    toolName,
    ordinal,
    outcome: { kind: 'success', result },
  };
}

function baseProfile(
  overrides: Partial<StrictToolMockProfileV1> = {}
): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
    ...overrides,
  };
}

function decode(profile: StrictToolMockProfileV1): DecodedStrictToolMockProfile {
  const expectedDigest = createHash('sha256')
    .update(canonicalMatrixCorpusStrictToolMockProfileV1(profile), 'utf8')
    .digest('hex');
  const expectedSchedule = profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
    turnIndex,
    toolName,
    ordinal,
  }));
  const result = decodeStrictToolMockProfile({ profile, expectedDigest, expectedSchedule });
  if (!result.ok) throw new Error(`Invalid test profile: ${result.code}`);
  return result;
}

function resultFor(toolName: IntexAgentToolNameV1): StrictMockResultV1 {
  switch (toolName) {
    case 'create_note':
    case 'create_research':
    case 'save_external':
      return { toolName, status: 'completed', message: 'Synthetic success' };
    case 'create_calendar_event':
      return { toolName, status: 'completed', eventId: 'mock_event_1', summary: 'Synthetic' };
    case 'update_calendar_event':
      return {
        toolName,
        status: 'completed',
        eventId: 'mock_event_1',
        summary: 'Synthetic',
        attendeesAdded: ['patryk@example.com'],
      };
    case 'query_calendar_events':
      return { toolName, status: 'completed', mode: 'count', count: 0 };
    case 'create_link':
      return {
        toolName,
        status: 'completed',
        bookmarkId: 'mock_bookmark_1',
        resourceUrl: 'https://mock.invalid/bookmarks/1',
      };
    case 'create_code_task':
      return { toolName, status: 'completed', codeTaskId: 'mock_code_task_1' };
    case 'get_user_preferences':
      return { toolName, status: 'completed', currentVersion: 0, items: [] };
    case 'add_user_preference':
    case 'update_user_preference':
    case 'delete_user_preference':
      return {
        toolName,
        status: 'completed',
        currentVersion: 1,
        changedItemId: 'mock_pref_1',
      };
  }
}
