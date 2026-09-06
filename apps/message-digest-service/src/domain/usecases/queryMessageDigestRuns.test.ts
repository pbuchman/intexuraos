import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { getMessageDigestRun, queryMessageDigestRuns } from './queryMessageDigestRuns.js';

describe('queryMessageDigestRuns', () => {
  it('converts inclusive local dates and forwards the exact bounded history grammar', async () => {
    const run = completedRun();
    const getOwnedDefinition = vi.fn<MessageDigestStore['getOwnedDefinition']>(async () =>
      definition()
    );
    const listOwnedRuns = vi.fn<MessageDigestStore['listOwnedRuns']>(async () => ({
      items: [run],
      nextCursor: 'opaque-next',
    }));

    const result = await queryMessageDigestRuns(
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        fromDate: '2026-03-29',
        toDate: '2026-03-29',
        generationStatus: 'completed',
        deliveryStatus: 'sent',
        direction: 'asc',
        limit: 7,
        cursor: 'opaque-current',
      },
      { store: { getOwnedDefinition, listOwnedRuns } }
    );

    expect(result).toEqual({ ok: true, items: [run], nextCursor: 'opaque-next' });
    expect(listOwnedRuns).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      limit: 7,
      cursor: 'opaque-current',
      windowStartFrom: '2026-03-28T23:00:00.000Z',
      windowStartBefore: '2026-03-29T22:00:00.000Z',
      generationStatus: 'completed',
      deliveryStatus: 'sent',
      direction: 'asc',
      queryFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('uses bounded descending defaults without date filters', async () => {
    const listOwnedRuns = vi.fn<MessageDigestStore['listOwnedRuns']>(async () => ({
      items: [],
      nextCursor: null,
    }));

    await queryMessageDigestRuns(
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
      {
        store: {
          getOwnedDefinition: vi.fn(async () => definition()),
          listOwnedRuns,
        },
      }
    );

    expect(listOwnedRuns).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, direction: 'desc' })
    );
  });

  it('rejects invalid filters and foreign definitions before listing history', async () => {
    const listOwnedRuns = vi.fn<MessageDigestStore['listOwnedRuns']>();
    const store = {
      getOwnedDefinition: vi.fn<MessageDigestStore['getOwnedDefinition']>(async () => definition()),
      listOwnedRuns,
    };
    await expect(
      queryMessageDigestRuns(
        {
          userId: 'synthetic-user-001',
          definitionId: 'md_definition_001',
          fromDate: '2026-07-28',
          toDate: '2026-07-27',
        },
        { store }
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_QUERY' });
    expect(listOwnedRuns).not.toHaveBeenCalled();

    store.getOwnedDefinition.mockResolvedValueOnce(null);
    await expect(
      queryMessageDigestRuns(
        { userId: 'synthetic-user-001', definitionId: 'md_foreign_001' },
        { store }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('returns one owner-visible run or the same static not-found result', async () => {
    const run = completedRun();
    const getOwnedRun = vi.fn<MessageDigestStore['getOwnedRun']>(async () => run);
    await expect(
      getMessageDigestRun(
        {
          userId: 'synthetic-user-001',
          definitionId: 'md_definition_001',
          runId: 'mdr_run_001',
        },
        { store: { getOwnedRun } }
      )
    ).resolves.toEqual({ ok: true, run });
    getOwnedRun.mockResolvedValueOnce(null);
    await expect(
      getMessageDigestRun(
        {
          userId: 'synthetic-user-001',
          definitionId: 'md_definition_001',
          runId: 'mdr_foreign_001',
        },
        { store: { getOwnedRun } }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('supports one-sided local date filters without inventing the other bound', async () => {
    const listOwnedRuns = vi.fn<MessageDigestStore['listOwnedRuns']>(async () => ({
      items: [],
      nextCursor: null,
    }));
    const store = {
      getOwnedDefinition: vi.fn<MessageDigestStore['getOwnedDefinition']>(async () => definition()),
      listOwnedRuns,
    };

    await queryMessageDigestRuns(
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        fromDate: '2026-03-29',
      },
      { store }
    );
    await queryMessageDigestRuns(
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        toDate: '2026-03-29',
      },
      { store }
    );

    expect(listOwnedRuns.mock.calls[0]?.[0]).toMatchObject({
      windowStartFrom: '2026-03-28T23:00:00.000Z',
    });
    expect(listOwnedRuns.mock.calls[0]?.[0]).not.toHaveProperty('windowStartBefore');
    expect(listOwnedRuns.mock.calls[1]?.[0]).toMatchObject({
      windowStartBefore: '2026-03-29T22:00:00.000Z',
    });
    expect(listOwnedRuns.mock.calls[1]?.[0]).not.toHaveProperty('windowStartFrom');
  });

  it('accepts every status filter and rejects every invalid list boundary', async () => {
    const listOwnedRuns = vi.fn<MessageDigestStore['listOwnedRuns']>(async () => ({
      items: [],
      nextCursor: null,
    }));
    const store = {
      getOwnedDefinition: vi.fn<MessageDigestStore['getOwnedDefinition']>(async () => definition()),
      listOwnedRuns,
    };
    for (const generationStatus of [
      'queued',
      'processing',
      'completed',
      'failed',
      'skipped_no_activity',
    ] as const) {
      await queryMessageDigestRuns(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001', generationStatus },
        { store }
      );
    }
    for (const deliveryStatus of [
      'not_sent',
      'pending',
      'sent',
      'ambiguous',
      'failed',
    ] as const) {
      await queryMessageDigestRuns(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001', deliveryStatus },
        { store }
      );
    }

    const invalidInputs = [
      { userId: ' ', definitionId: 'md_definition_001' },
      { userId: 'synthetic-user-001', definitionId: ' ' },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', limit: 1.5 },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', limit: 0 },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', limit: 51 },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', cursor: ' ' },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', sort: 'createdAt' },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', direction: 'sideways' },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', generationStatus: 'other' },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', deliveryStatus: 'other' },
    ];
    for (const input of invalidInputs) {
      await expect(
        queryMessageDigestRuns(input as Parameters<typeof queryMessageDigestRuns>[0], { store })
      ).resolves.toEqual({ ok: false, code: 'INVALID_QUERY' });
    }
  });

  it('maps invalid cursors, rethrows unexpected failures, and rejects blank run identity', async () => {
    const baseStore = {
      getOwnedDefinition: vi.fn<MessageDigestStore['getOwnedDefinition']>(async () => definition()),
      listOwnedRuns: vi.fn<MessageDigestStore['listOwnedRuns']>(async () => {
        throw new Error('INVALID_CURSOR');
      }),
    };
    await expect(
      queryMessageDigestRuns(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        { store: baseStore }
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_CURSOR' });
    baseStore.listOwnedRuns.mockRejectedValueOnce(new Error('synthetic store failure'));
    await expect(
      queryMessageDigestRuns(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        { store: baseStore }
      )
    ).rejects.toThrow('synthetic store failure');

    const getOwnedRun = vi.fn<MessageDigestStore['getOwnedRun']>();
    for (const input of [
      { userId: ' ', definitionId: 'md_definition_001', runId: 'mdr_run_001' },
      { userId: 'synthetic-user-001', definitionId: ' ', runId: 'mdr_run_001' },
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001', runId: ' ' },
    ]) {
      await expect(getMessageDigestRun(input, { store: { getOwnedRun } })).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
  });
});

function definition(): MessageDigestDefinition {
  return {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Synthetic digest',
    nameSortKey: 'synthetic digest',
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
      displayName: 'Synthetic group',
      sourceRevision: 'synthetic-source-revision',
    },
    instructions: {
      templateId: 'custom',
      text: 'Create a bounded digest from this synthetic conversation source.',
      revision: '1',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'readiness-v1',
      readinessObservedAt: '2026-07-27T12:00:00.000Z',
    },
    checkpointAt: '2026-07-27T12:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: '2026-07-27T12:02:00.000Z',
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T07:00:00.000Z',
    updatedAt: '2026-07-27T12:02:00.000Z',
  };
}

function completedRun(): MessageDigestRun {
  const record = definition();
  return {
    version: 1,
    runId: 'mdr_run_001',
    userId: record.userId,
    definitionId: record.definitionId,
    definitionNameSnapshot: record.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: record.revision,
    instructionRevision: record.instructions.revision,
    trigger: 'manual',
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-27T07:00:00.000Z',
    windowEnd: '2026-07-27T12:00:00.000Z',
    scheduledBoundary: '2026-07-27T12:00:00.000Z',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    attempts: 1,
    sourceSnapshot: record.source,
    instructionsSnapshot: record.instructions,
    scheduleSnapshot: record.schedule,
    headline: 'Synthetic digest',
    summaryMarkdown: '- A bounded fact.',
    evidenceMessageRefs: ['c'.repeat(64)],
    continuityMemoryMarkdown: 'Synthetic continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001 },
    delivery: {
      type: 'whatsapp_primary',
      status: 'sent',
      idempotencyKey: 'message-digest:mdr_run_001',
      acceptedAt: '2026-07-27T12:03:00.000Z',
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 1,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T12:01:00.000Z',
    updatedAt: '2026-07-27T12:03:00.000Z',
    completedAt: '2026-07-27T12:02:00.000Z',
  };
}
