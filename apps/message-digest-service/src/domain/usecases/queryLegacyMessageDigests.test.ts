import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import {
  queryLegacyDigestDefinitions,
  queryLegacyDigestRuns,
  resolveLegacyDigestRun,
} from './queryLegacyMessageDigests.js';

describe('queryLegacyDigestDefinitions', () => {
  it('returns one content-safe projection for the exact active migrated alias', async () => {
    const getDefinition = vi.fn<MessageDigestStore['getOwnedDefinitionByLegacyAlias']>(async () =>
      definition()
    );

    const result = await queryLegacyDigestDefinitions(
      { userId: 'synthetic-user-001', legacyGroupKey: 'synthetic-fishing-group' },
      { store: { getOwnedDefinitionByLegacyAlias: getDefinition } }
    );

    expect(result).toEqual({
      ok: true,
      items: [
        {
          definitionId: 'md_definition_001',
          legacyGroupKey: 'synthetic-fishing-group',
          source: {
            sourceAccountId: 'synthetic-account-001',
            generationId: 'synthetic-generation-001',
            chatId: 'synthetic-chat-001',
            chatType: 'group',
          },
          activeMigrationId: 'mdm_migration_001',
        },
      ],
    });
    expect(getDefinition).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
    });
    expect(JSON.stringify(result)).not.toContain('Private fishing prompt');
    expect(JSON.stringify(result)).not.toContain('continuity');
  });

  it.each([
    { status: 'migrating' },
    { status: 'deleting' },
    { activeMigrationId: null },
    { legacyAlias: null },
    { legacyAlias: { groupKey: 'some-other-group' } },
    { source: { ...definition().source, chatType: 'direct' } },
  ])('makes a hidden, foreign, or direct definition absent: %o', async (override) => {
    const record = definition(override as Partial<MessageDigestDefinition>);
    const result = await queryLegacyDigestDefinitions(
      { userId: 'synthetic-user-001', legacyGroupKey: 'synthetic-fishing-group' },
      {
        store: {
          getOwnedDefinitionByLegacyAlias: vi.fn(async () => record),
        },
      }
    );

    expect(result).toEqual({ ok: true, items: [] });
  });

  it('rejects invalid identifiers before storage', async () => {
    const getDefinition = vi.fn<MessageDigestStore['getOwnedDefinitionByLegacyAlias']>();
    const result = await queryLegacyDigestDefinitions(
      { userId: ' ', legacyGroupKey: 'Invalid Alias' },
      { store: { getOwnedDefinitionByLegacyAlias: getDefinition } }
    );

    expect(result).toEqual({ ok: false, code: 'INVALID_QUERY' });
    expect(getDefinition).not.toHaveBeenCalled();
  });
});

describe('queryLegacyDigestRuns', () => {
  it('queries conservative scheduled boundaries and returns only visible fenced summaries', async () => {
    const record = definition();
    const getDefinition = vi.fn<MessageDigestStore['getOwnedDefinitionByLegacyAlias']>(async () =>
      record
    );
    const listRuns = vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => ({
      items: [
        run(),
        run({ runId: 'mdr_staged_001', visibilityMigrationId: 'mdm_migration_001' }),
        run({ runId: 'mdr_audit_001', recordRole: 'audit' }),
        run({
          runId: 'mdr_foreign_source_001',
          sourceSnapshot: { ...record.source, generationId: 'some-other-generation' },
        }),
        run({ runId: 'mdr_failed_001', generationStatus: 'failed', headline: null }),
      ],
      nextCursor: 'next-opaque-cursor',
    }));

    const result = await queryLegacyDigestRuns(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        fromDate: '2026-07-01',
        toDate: '2026-07-31',
        terms: [' Catch ', 'MEETING'],
        limit: 100,
        cursor: 'opaque-cursor',
      },
      {
        store: {
          getOwnedDefinitionByLegacyAlias: getDefinition,
          listOwnedLegacyRuns: listRuns,
        },
      }
    );

    expect(result).toEqual({
      ok: true,
      items: [
        {
          definitionId: 'md_definition_001',
          runId: 'mdr_run_001',
          legacyGroupKey: 'synthetic-fishing-group',
          date: '2026-07-27',
          title: 'Fishing plans',
          summaryMarkdown: '- The catch was strong.\n- Meet at dawn.',
          messageCount: 12,
          evidenceMessageRefs: ['c'.repeat(64)],
          windowStart: '2026-07-26T07:00:00.000Z',
          windowEnd: '2026-07-27T07:00:00.000Z',
        },
      ],
      truncated: true,
      nextCursor: 'next-opaque-cursor',
    });
    expect(listRuns).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      activeMigrationId: 'mdm_migration_001',
      legacyGroupKey: 'synthetic-fishing-group',
      limit: 100,
      cursor: 'opaque-cursor',
      scheduledBoundaryFrom: '2026-06-30T10:00:00.000Z',
      scheduledBoundaryBefore: '2026-08-01T14:00:00.000Z',
      queryFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-account-001');
    expect(JSON.stringify(result)).not.toContain('Private fishing prompt');
  });

  it('keeps historical local dates and cursor scope stable after the definition timezone changes', async () => {
    const historicalRun = run({
      scheduledBoundary: '2026-07-27T22:30:00.000Z',
      scheduleSnapshot: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    });
    const outsideLocalDay = run({
      runId: 'mdr_outside_local_day_001',
      scheduledBoundary: '2026-07-27T22:00:00.000Z',
      scheduleSnapshot: { kind: 'daily', localTime: '09:00', timeZone: 'UTC' },
    });
    const calls: Parameters<MessageDigestStore['listOwnedLegacyRuns']>[0][] = [];

    for (const timeZone of ['Europe/Warsaw', 'America/Los_Angeles']) {
      const currentDefinition = definition({
        schedule: { kind: 'daily', localTime: '09:00', timeZone },
      });
      const listRuns = vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async (input) => {
        calls.push(input);
        return { items: [outsideLocalDay, historicalRun], nextCursor: null };
      });

      const result = await queryLegacyDigestRuns(
        {
          userId: 'synthetic-user-001',
          legacyGroupKey: 'synthetic-fishing-group',
          fromDate: '2026-07-28',
          toDate: '2026-07-28',
          limit: 25,
        },
        {
          store: {
            getOwnedDefinitionByLegacyAlias: vi.fn(async () => currentDefinition),
            listOwnedLegacyRuns: listRuns,
          },
        }
      );

      expect(result).toMatchObject({
        ok: true,
        items: [{ runId: 'mdr_run_001', date: '2026-07-28' }],
      });
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      scheduledBoundaryFrom: '2026-07-27T10:00:00.000Z',
      scheduledBoundaryBefore: '2026-07-29T14:00:00.000Z',
    });
    expect(calls[1]).toEqual(calls[0]);
  });

  it('uses case-insensitive OR term matching over the headline and summary only', async () => {
    const listRuns = vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => ({
      items: [
        run(),
        run({
          runId: 'mdr_meeting_001',
          headline: 'Club MEETING',
          summaryMarkdown: '- No relevant catch.',
        }),
        run({
          runId: 'mdr_hidden_word_001',
          headline: 'Weather',
          summaryMarkdown: '- Calm day.',
          continuityMemoryMarkdown: 'secret needle',
        }),
      ],
      nextCursor: null,
    }));

    const result = await queryLegacyDigestRuns(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        terms: ['meeting', 'needle'],
        limit: 25,
      },
      { store: storeWithDefinition(listRuns) }
    );

    expect(result).toMatchObject({
      ok: true,
      items: [{ runId: 'mdr_meeting_001' }],
      truncated: false,
      nextCursor: null,
    });
  });

  it('returns an empty page without touching runs when the alias is absent', async () => {
    const listRuns = vi.fn<MessageDigestStore['listOwnedLegacyRuns']>();
    const result = await queryLegacyDigestRuns(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        limit: 25,
      },
      {
        store: {
          getOwnedDefinitionByLegacyAlias: vi.fn(async () => null),
          listOwnedLegacyRuns: listRuns,
        },
      }
    );

    expect(result).toEqual({ ok: true, items: [], truncated: false, nextCursor: null });
    expect(listRuns).not.toHaveBeenCalled();
  });

  it.each([
    { fromDate: 'not-a-date' },
    { fromDate: '2026-02-30' },
    { fromDate: '2026-07-02', toDate: '2026-07-01' },
    { terms: [] },
    { terms: [''] },
    { terms: Array.from({ length: 21 }, (_, index) => `term-${String(index)}`) },
    { limit: 0 },
    { limit: 101 },
    { cursor: 'c'.repeat(4_097) },
  ])('rejects invalid bounded inputs before storage: %o', async (override) => {
    const getDefinition = vi.fn<MessageDigestStore['getOwnedDefinitionByLegacyAlias']>();
    const result = await queryLegacyDigestRuns(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        limit: 25,
        ...override,
      },
      {
        store: {
          getOwnedDefinitionByLegacyAlias: getDefinition,
          listOwnedLegacyRuns: vi.fn(),
        },
      }
    );

    expect(result).toEqual({ ok: false, code: 'INVALID_QUERY' });
    expect(getDefinition).not.toHaveBeenCalled();
  });

  it('maps a store cursor rejection to INVALID_CURSOR', async () => {
    const listRuns = vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => {
      throw new Error('INVALID_CURSOR');
    });
    const result = await queryLegacyDigestRuns(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        limit: 25,
        cursor: 'bad-cursor',
      },
      { store: storeWithDefinition(listRuns) }
    );

    expect(result).toEqual({ ok: false, code: 'INVALID_CURSOR' });

    const unexpected = new TypeError('synthetic storage outage');
    const unavailableStore = vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => {
      throw unexpected;
    });
    await expect(
      queryLegacyDigestRuns(
        {
          userId: 'synthetic-user-001',
          legacyGroupKey: 'synthetic-fishing-group',
          limit: 25,
        },
        { store: storeWithDefinition(unavailableStore) }
      )
    ).rejects.toBe(unexpected);
  });

  it('fails explicitly if Intl omits a required local-date component', async () => {
    const formatToParts = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockReturnValue([
        { type: 'year', value: '2026' },
        { type: 'month', value: '07' },
      ]);

    try {
      await expect(
        queryLegacyDigestRuns(
          {
            userId: 'synthetic-user-001',
            legacyGroupKey: 'synthetic-fishing-group',
            limit: 25,
          },
          {
            store: storeWithDefinition(
              vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => ({
                items: [run()],
                nextCursor: null,
              }))
            ),
          }
        )
      ).rejects.toThrow('INVALID_SCHEDULED_BOUNDARY');
    } finally {
      formatToParts.mockRestore();
    }
  });
});

describe('resolveLegacyDigestRun', () => {
  it('returns canonical identifiers only for the exact owned alias date', async () => {
    const result = await resolveLegacyDigestRun(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        date: '2026-07-27',
      },
      {
        store: storeWithDefinition(
          vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => ({
            items: [run()],
            nextCursor: null,
          }))
        ),
      }
    );

    expect(result).toEqual({
      ok: true,
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
    });
    expect(Object.keys(result)).toEqual(['ok', 'definitionId', 'runId']);
  });

  it('continues past adjacent local-day records until it finds the requested historical date', async () => {
    const listRuns = vi
      .fn<MessageDigestStore['listOwnedLegacyRuns']>()
      .mockResolvedValueOnce({
        items: [
          run({
            runId: 'mdr_adjacent_day_001',
            scheduledBoundary: '2026-07-28T13:00:00.000Z',
            scheduleSnapshot: {
              kind: 'daily',
              localTime: '09:00',
              timeZone: 'Pacific/Kiritimati',
            },
          }),
        ],
        nextCursor: 'cursor-after-adjacent-day',
      })
      .mockResolvedValueOnce({
        items: [
          run({
            scheduledBoundary: '2026-07-27T22:30:00.000Z',
            scheduleSnapshot: {
              kind: 'daily',
              localTime: '09:00',
              timeZone: 'Europe/Warsaw',
            },
          }),
        ],
        nextCursor: null,
      });

    const result = await resolveLegacyDigestRun(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        date: '2026-07-28',
      },
      { store: storeWithDefinition(listRuns) }
    );

    expect(result).toEqual({
      ok: true,
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
    });
    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(listRuns.mock.calls[1]?.[0]).toMatchObject({
      limit: 100,
      cursor: 'cursor-after-adjacent-day',
    });
  });

  it('fails closed when a resolver page repeats its signed cursor', async () => {
    const listRuns = vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => ({
      items: [
        run({
          runId: 'mdr_adjacent_day_001',
          scheduledBoundary: '2026-07-28T13:00:00.000Z',
          scheduleSnapshot: {
            kind: 'daily',
            localTime: '09:00',
            timeZone: 'Pacific/Kiritimati',
          },
        }),
      ],
      nextCursor: 'repeated-signed-cursor',
    }));

    await expect(
      resolveLegacyDigestRun(
        {
          userId: 'synthetic-user-001',
          legacyGroupKey: 'synthetic-fishing-group',
          date: '2026-07-28',
        },
        { store: storeWithDefinition(listRuns) }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(listRuns).toHaveBeenCalledTimes(2);
  });

  it('returns NOT_FOUND for a missing alias, invalid date, or empty canonical day', async () => {
    const missingAlias = await resolveLegacyDigestRun(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        date: '2026-07-27',
      },
      {
        store: {
          getOwnedDefinitionByLegacyAlias: vi.fn(async () => null),
          listOwnedLegacyRuns: vi.fn(),
        },
      }
    );
    const invalidDate = await resolveLegacyDigestRun(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        date: '2026-02-30',
      },
      { store: storeWithDefinition(vi.fn()) }
    );
    const emptyDay = await resolveLegacyDigestRun(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        date: '2026-07-27',
      },
      {
        store: storeWithDefinition(
          vi.fn<MessageDigestStore['listOwnedLegacyRuns']>(async () => ({
            items: [],
            nextCursor: null,
          }))
        ),
      }
    );

    expect(missingAlias).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(invalidDate).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(emptyDay).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

function storeWithDefinition(
  listOwnedLegacyRuns: MessageDigestStore['listOwnedLegacyRuns']
): Pick<
  MessageDigestStore,
  'getOwnedDefinitionByLegacyAlias' | 'listOwnedLegacyRuns'
> {
  return {
    getOwnedDefinitionByLegacyAlias: vi.fn(async () => definition()),
    listOwnedLegacyRuns,
  };
}

function definition(
  overrides: Partial<MessageDigestDefinition> = {}
): MessageDigestDefinition {
  return {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Synthetic fishing digest',
    nameSortKey: 'synthetic fishing digest',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: true,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Synthetic fishing group',
      sourceRevision: 'synthetic-source-revision-001',
    },
    instructions: {
      templateId: 'fishing_group',
      text: 'Private fishing prompt that must never leave the service.',
      revision: '1',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'readiness-001',
      readinessObservedAt: '2026-07-27T06:00:00.000Z',
    },
    checkpointAt: '2026-07-27T07:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: '2026-07-27T07:00:00.000Z',
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: 'mdm_migration_001',
    legacyAlias: { groupKey: 'synthetic-fishing-group' },
    createdAt: '2026-07-01T07:00:00.000Z',
    updatedAt: '2026-07-27T07:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<MessageDigestRun> = {}): MessageDigestRun {
  const record = definition();
  return {
    version: 1,
    runId: 'mdr_run_001',
    userId: record.userId,
    definitionId: record.definitionId,
    definitionNameSnapshot: record.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: 1,
    instructionRevision: '1',
    trigger: 'scheduled',
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-26T07:00:00.000Z',
    windowEnd: '2026-07-27T07:00:00.000Z',
    scheduledBoundary: '2026-07-27T07:00:00.000Z',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    attempts: 1,
    sourceSnapshot: record.source,
    instructionsSnapshot: record.instructions,
    scheduleSnapshot: record.schedule,
    headline: 'Fishing plans',
    summaryMarkdown: '- The catch was strong.\n- Meet at dawn.',
    evidenceMessageRefs: ['c'.repeat(64)],
    continuityMemoryMarkdown: 'Private continuity state.',
    effectiveMessageCount: 12,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 },
    delivery: {
      type: 'whatsapp_primary',
      status: 'sent',
      idempotencyKey: 'message-digest:mdr_run_001',
      acceptedAt: '2026-07-27T07:01:00.000Z',
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T07:00:00.000Z',
    updatedAt: '2026-07-27T07:01:00.000Z',
    completedAt: '2026-07-27T07:00:30.000Z',
    ...overrides,
  };
}
