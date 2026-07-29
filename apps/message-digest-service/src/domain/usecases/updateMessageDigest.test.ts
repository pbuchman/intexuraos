import { describe, expect, it, vi, type Mock } from 'vitest';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import type { ValidatedMessageDigestSource } from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { updateMessageDigest } from './updateMessageDigest.js';

const NOW = '2026-07-27T12:00:00.000Z';

interface UpdateHarnessOptions {
  definition?: MessageDigestDefinition | null;
  readinessStatus?: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
}

interface UpdateHarness {
  updateRecord: Mock<Pick<MessageDigestStore, 'updateDefinition'>['updateDefinition']>;
  validateSource: Mock<MessageDigestWhatsAppClient['validateSource']>;
  getReadiness: Mock<MessageDigestWhatsAppClient['getDeliveryReadiness']>;
  deps: Parameters<typeof updateMessageDigest>[1];
}

describe('updateMessageDigest', () => {
  it('accepts an 80-character normalized name and rejects 81 characters', async () => {
    const accepted = createHarness();
    await expect(
      updateMessageDigest(baseInput({ name: `  ${'n'.repeat(80)}  ` }), accepted.deps)
    ).resolves.toMatchObject({ ok: true, definition: { name: 'n'.repeat(80) } });

    const rejected = createHarness();
    await expect(
      updateMessageDigest(baseInput({ name: 'n'.repeat(81) }), rejected.deps)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(rejected.updateRecord).not.toHaveBeenCalled();
  });

  it('returns the same not-found result for missing and foreign definitions', async () => {
    const harness = createHarness({ definition: null });

    await expect(
      updateMessageDigest(baseInput({ name: 'Renamed digest' }), harness.deps)
    ).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(harness.updateRecord).not.toHaveBeenCalled();
    expect(harness.validateSource).not.toHaveBeenCalled();
  });

  it('rejects stale revisions before any external observation or write', async () => {
    const harness = createHarness();

    await expect(
      updateMessageDigest(
        { ...baseInput({ name: 'Renamed digest' }), expectedRevision: 41 },
        harness.deps
      )
    ).resolves.toEqual({ ok: false, code: 'REVISION_CONFLICT' });
    expect(harness.getReadiness).not.toHaveBeenCalled();
    expect(harness.updateRecord).not.toHaveBeenCalled();
  });

  it('applies name, instructions, and schedule prospectively without resetting checkpoint', async () => {
    const harness = createHarness();

    const result = await updateMessageDigest(
      baseInput({
        name: '  Decisions daily  ',
        instructions: {
          templateId: 'direct_sentiment',
          text: 'Summarize the sentiment and notable changes in this direct conversation.',
        },
        schedule: { kind: 'daily', localTime: '10:30', timeZone: 'Europe/Warsaw' },
      }),
      harness.deps
    );

    expect(result).toMatchObject({ ok: true, definition: { revision: 2 } });
    expect(harness.updateRecord).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedRevision: 1,
      updatedAt: NOW,
      patch: {
        name: 'Decisions daily',
        nameSortKey: 'decisions daily',
        instructions: {
          templateId: 'direct_sentiment',
          text: 'Summarize the sentiment and notable changes in this direct conversation.',
          revision: '2',
        },
        schedule: { kind: 'daily', localTime: '10:30', timeZone: 'Europe/Warsaw' },
        nextRunAt: '2026-07-28T08:30:00.000Z',
        listStatus: 'active',
        attentionCode: null,
      },
    });
    expect(harness.validateSource).not.toHaveBeenCalled();
    expect(harness.getReadiness).not.toHaveBeenCalled();
  });

  it('revalidates and atomically resets unopened continuity when replacing a source', async () => {
    const harness = createHarness();

    const result = await updateMessageDigest(
      baseInput({ source: { chatId: 'synthetic-chat-replacement' } }),
      harness.deps
    );

    expect(result.ok).toBe(true);
    expect(harness.validateSource).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-replacement',
    });
    expect(harness.getReadiness).toHaveBeenCalledWith('synthetic-user-001');
    expect(harness.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          source: expect.objectContaining({
            chatId: 'synthetic-chat-replacement',
            chatType: 'direct',
          }),
          resetCheckpointAt: '2026-07-27T07:00:00.000Z',
          nextRunAt: '2026-07-28T07:00:00.000Z',
          delivery: expect.objectContaining({ readinessObservationVersion: 'ready-v2' }),
        }),
      })
    );
  });

  it('locks source replacement after the first run without calling WhatsApp', async () => {
    const harness = createHarness({ definition: definition({ hasRuns: true }) });

    await expect(
      updateMessageDigest(
        baseInput({ source: { chatId: 'synthetic-chat-replacement' } }),
        harness.deps
      )
    ).resolves.toEqual({ ok: false, code: 'SOURCE_LOCKED' });
    expect(harness.validateSource).not.toHaveBeenCalled();
    expect(harness.updateRecord).not.toHaveBeenCalled();
  });

  it('pauses without readiness and resumes only after a fresh ready observation', async () => {
    const active = createHarness();
    await expect(
      updateMessageDigest(baseInput({ status: 'paused' }), active.deps)
    ).resolves.toMatchObject({
      ok: true,
      definition: { status: 'paused' },
    });
    expect(active.getReadiness).not.toHaveBeenCalled();
    expect(active.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { status: 'paused', listStatus: 'paused', attentionCode: null },
      })
    );

    const blocked = createHarness({
      definition: definition({ status: 'paused', listStatus: 'paused' }),
      readinessStatus: 'disconnected',
    });
    await expect(
      updateMessageDigest(baseInput({ status: 'active' }), blocked.deps)
    ).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_NOT_READY',
    });
    expect(blocked.updateRecord).not.toHaveBeenCalled();

    const ready = createHarness({
      definition: definition({ status: 'paused', listStatus: 'paused' }),
    });
    await expect(
      updateMessageDigest(baseInput({ status: 'active' }), ready.deps)
    ).resolves.toMatchObject({
      ok: true,
      definition: { status: 'active' },
    });
    expect(ready.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          status: 'active',
          listStatus: 'active',
          attentionCode: null,
          nextRunAt: '2026-07-28T07:00:00.000Z',
          delivery: {
            type: 'whatsapp_primary',
            readinessObservationVersion: 'ready-v2',
            readinessObservedAt: NOW,
          },
        }),
      })
    );
  });

  it('surfaces a transactional run-in-progress pause rejection unchanged', async () => {
    const harness = createHarness();
    harness.updateRecord.mockResolvedValueOnce({ ok: false, code: 'RUN_IN_PROGRESS' });

    await expect(
      updateMessageDigest(baseInput({ status: 'paused' }), harness.deps)
    ).resolves.toEqual({ ok: false, code: 'RUN_IN_PROGRESS' });
    expect(harness.getReadiness).not.toHaveBeenCalled();
  });

  it('revalidates the existing source and resumes at the first future cadence without resetting checkpoint', async () => {
    const ready = createHarness({
      definition: definition({
        status: 'paused',
        listStatus: 'paused',
        schedule: {
          kind: 'weekly',
          weekday: 'thursday',
          localTime: '09:00',
          timeZone: 'Europe/Warsaw',
        },
        checkpointAt: '2026-07-02T07:00:00.000Z',
        nextRunAt: '2026-07-09T07:00:00.000Z',
      }),
    });

    await expect(
      updateMessageDigest(baseInput({ status: 'active' }), ready.deps)
    ).resolves.toMatchObject({ ok: true, definition: { status: 'active' } });
    expect(ready.validateSource).toHaveBeenCalledTimes(1);
    expect(ready.validateSource).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-001',
      expectedGenerationId: 'synthetic-generation-001',
    });
    expect(ready.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          status: 'active',
          listStatus: 'active',
          attentionCode: null,
          nextRunAt: '2026-07-30T07:00:00.000Z',
          delivery: {
            type: 'whatsapp_primary',
            readinessObservationVersion: 'ready-v2',
            readinessObservedAt: NOW,
          },
        },
      })
    );
    expect(ready.updateRecord.mock.calls[0]?.[0].patch).not.toHaveProperty(
      'resetCheckpointAt'
    );
  });

  it('marks an explicit needs-attention resume as the failed-window recovery boundary', async () => {
    const ready = createHarness({
      definition: definition({
        status: 'paused',
        listStatus: 'needs_attention',
        attentionCode: 'SOURCE_TOO_LARGE',
      }),
    });

    await expect(
      updateMessageDigest(baseInput({ status: 'active' }), ready.deps)
    ).resolves.toMatchObject({ ok: true, definition: { status: 'active' } });
    expect(ready.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          status: 'active',
          listStatus: 'active',
          attentionCode: null,
          releaseFailedPendingWindow: true,
        }),
      })
    );
  });

  it.each([
    ['not_found', 'SOURCE_NOT_FOUND'],
    ['source_changed', 'SOURCE_CHANGED'],
    ['unavailable', 'SOURCE_UNAVAILABLE'],
  ] as const)('blocks resume when existing source validation returns %s', async (failure, code) => {
    const harness = createHarness({
      definition: definition({ status: 'paused', listStatus: 'paused' }),
    });
    harness.validateSource.mockResolvedValueOnce({ ok: false, code: failure });

    await expect(
      updateMessageDigest(baseInput({ status: 'active' }), harness.deps)
    ).resolves.toEqual({ ok: false, code });
    expect(harness.getReadiness).not.toHaveBeenCalled();
    expect(harness.updateRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['source account', { sourceAccountId: 'synthetic-account-other' }],
    ['generation', { generationId: 'synthetic-generation-other' }],
    ['chat ID', { chatId: 'synthetic-chat-other' }],
    ['chat type', { chatType: 'direct' as const }],
  ])('blocks resume when the validated %s no longer matches the frozen source', async (_label, sourcePatch) => {
    const harness = createHarness({
      definition: definition({ status: 'paused', listStatus: 'paused' }),
    });
    harness.validateSource.mockResolvedValueOnce({
      ok: true,
      value: validatedExistingSource(sourcePatch),
    });

    await expect(
      updateMessageDigest(baseInput({ status: 'active' }), harness.deps)
    ).resolves.toEqual({ ok: false, code: 'SOURCE_CHANGED' });
    expect(harness.validateSource).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-001',
      expectedGenerationId: 'synthetic-generation-001',
    });
    expect(harness.getReadiness).not.toHaveBeenCalled();
    expect(harness.updateRecord).not.toHaveBeenCalled();
  });

  it('rejects invalid envelopes and prospective field values before writing', async () => {
    const invalidInputs: Parameters<typeof updateMessageDigest>[0][] = [
      { ...baseInput({ name: 'Valid name' }), userId: ' ' },
      { ...baseInput({ name: 'Valid name' }), definitionId: ' ' },
      { ...baseInput({ name: 'Valid name' }), expectedRevision: 1.5 },
      { ...baseInput({ name: 'Valid name' }), expectedRevision: 0 },
      baseInput({}),
      baseInput({ source: { chatId: ' ' } }),
      baseInput({ name: ' ' }),
      baseInput({ name: 'x'.repeat(81) }),
      baseInput({ instructions: { templateId: 'custom', text: 'too short' } }),
      baseInput({ instructions: { templateId: 'custom', text: 'x'.repeat(4_001) } }),
    ];
    for (const input of invalidInputs) {
      const harness = createHarness();
      await expect(updateMessageDigest(input, harness.deps)).resolves.toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      expect(harness.updateRecord).not.toHaveBeenCalled();
    }

    const invalidNow = createHarness();
    invalidNow.deps.now = (): string => 'not-an-instant';
    await expect(
      updateMessageDigest(baseInput({ name: 'Valid name' }), invalidNow.deps)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });

    const defaultClock = createHarness();
    defaultClock.deps.now = undefined;
    await expect(
      updateMessageDigest({ ...baseInput({ name: 'Valid name' }), userId: ' ' }, defaultClock.deps)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('rejects invalid schedule, source validation failures, and readiness outages', async () => {
    const invalidSchedule = createHarness();
    await expect(
      updateMessageDigest(
        baseInput({ schedule: { kind: 'daily', localTime: 'invalid', timeZone: 'UTC' } }),
        invalidSchedule.deps
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_SCHEDULE' });

    for (const [failure, code] of [
      ['not_found', 'SOURCE_NOT_FOUND'],
      ['unavailable', 'SOURCE_UNAVAILABLE'],
    ] as const) {
      const harness = createHarness();
      harness.validateSource.mockResolvedValueOnce({ ok: false, code: failure });
      await expect(
        updateMessageDigest(
          baseInput({ source: { chatId: 'synthetic-chat-replacement' } }),
          harness.deps
        )
      ).resolves.toEqual({ ok: false, code });
      expect(harness.updateRecord).not.toHaveBeenCalled();
    }

    const unavailable = createHarness({
      definition: definition({ status: 'paused', listStatus: 'paused' }),
    });
    unavailable.getReadiness.mockResolvedValueOnce({ ok: false, code: 'unavailable' });
    await expect(
      updateMessageDigest(baseInput({ status: 'active' }), unavailable.deps)
    ).resolves.toEqual({ ok: false, code: 'READINESS_UNAVAILABLE' });
  });

  it('keeps a paused replacement visible as needs-attention when delivery is not ready', async () => {
    const harness = createHarness({ readinessStatus: 'mapping_missing' });

    await expect(
      updateMessageDigest(
        baseInput({
          source: { chatId: 'synthetic-chat-replacement' },
          status: 'paused',
        }),
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      definition: {
        status: 'paused',
        listStatus: 'needs_attention',
        attentionCode: 'DELIVERY_SETUP_REQUIRED',
      },
    });
  });

  it('increments non-numeric instruction revisions and forwards safe store failures', async () => {
    const nonNumeric = createHarness({
      definition: definition({
        instructions: {
          templateId: 'custom',
          text: 'Summarize the important decisions and follow-ups from this chat.',
          revision: 'legacy-v1',
        },
      }),
    });
    await updateMessageDigest(
      baseInput({
        instructions: {
          templateId: 'custom',
          text: 'Summarize important decisions and the next concrete follow-up action.',
        },
      }),
      nonNumeric.deps
    );
    expect(nonNumeric.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          instructions: expect.objectContaining({ revision: 'legacy-v1.next' }),
        }),
      })
    );

    const conflict = createHarness();
    conflict.updateRecord.mockResolvedValueOnce({ ok: false, code: 'REVISION_CONFLICT' });
    await expect(
      updateMessageDigest(baseInput({ name: 'Renamed digest' }), conflict.deps)
    ).resolves.toEqual({ ok: false, code: 'REVISION_CONFLICT' });
  });
});

function baseInput(
  patch: Parameters<typeof updateMessageDigest>[0]['patch']
): Parameters<typeof updateMessageDigest>[0] {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    expectedRevision: 1,
    patch,
  };
}

function definition(overrides: Partial<MessageDigestDefinition> = {}): MessageDigestDefinition {
  return {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Daily chat summary',
    nameSortKey: 'daily chat summary',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Fishing friends',
      sourceRevision: 'synthetic-source-revision-001',
    },
    instructions: {
      templateId: 'custom',
      text: 'Summarize the important decisions and follow-ups from this chat.',
      revision: '1',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'ready-v1',
      readinessObservedAt: '2026-07-27T10:00:00.000Z',
    },
    checkpointAt: '2026-07-27T07:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
    ...overrides,
  };
}

function validatedExistingSource(
  overrides: Partial<ValidatedMessageDigestSource> = {}
): ValidatedMessageDigestSource {
  return {
    sourceAccountId: 'synthetic-account-001',
    generationId: 'synthetic-generation-001',
    chatId: 'synthetic-chat-001',
    chatType: 'group',
    displayName: 'Fishing friends',
    messageCount: 42,
    participantCount: 8,
    sourceRevision: 'synthetic-source-revision-002',
    ...overrides,
  };
}

function createHarness(options: UpdateHarnessOptions = {}): UpdateHarness {
  const existing = options.definition === undefined ? definition() : options.definition;
  const getOwnedDefinition = vi.fn<
    Pick<MessageDigestStore, 'getOwnedDefinition'>['getOwnedDefinition']
  >(async () => existing);
  const updateRecord = vi.fn<Pick<MessageDigestStore, 'updateDefinition'>['updateDefinition']>(
    async (input) => {
      if (existing === null) return { ok: false, code: 'NOT_FOUND' };
      return {
        ok: true,
        definition: {
          ...existing,
          name: input.patch.name ?? existing.name,
          nameSortKey: input.patch.nameSortKey ?? existing.nameSortKey,
          status: input.patch.status ?? existing.status,
          listStatus: input.patch.listStatus ?? existing.listStatus,
          attentionCode:
            input.patch.attentionCode === undefined
              ? existing.attentionCode
              : input.patch.attentionCode,
          source: input.patch.source ?? existing.source,
          instructions: input.patch.instructions ?? existing.instructions,
          schedule: input.patch.schedule ?? existing.schedule,
          delivery: input.patch.delivery ?? existing.delivery,
          checkpointAt: input.patch.resetCheckpointAt ?? existing.checkpointAt,
          nextRunAt: input.patch.nextRunAt ?? existing.nextRunAt,
          revision: existing.revision + 1,
          updatedAt: input.updatedAt,
        },
      };
    }
  );
  const validateSource = vi.fn<MessageDigestWhatsAppClient['validateSource']>(
    async ({ chatId, expectedGenerationId }) =>
      expectedGenerationId === undefined
        ? {
            ok: true,
            value: {
              sourceAccountId: 'synthetic-account-001',
              generationId: 'synthetic-generation-002',
              chatId,
              chatType: 'direct',
              displayName: 'Replacement contact',
              messageCount: 42,
              sourceRevision: 'synthetic-source-revision-002',
            },
          }
        : { ok: true, value: validatedExistingSource({ chatId, generationId: expectedGenerationId }) }
  );
  const getReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(async () => ({
    ok: true,
    value: {
      status: options.readinessStatus ?? 'ready',
      observationVersion: 'ready-v2',
      observedAt: NOW,
    },
  }));
  return {
    updateRecord,
    validateSource,
    getReadiness,
    deps: {
      store: { getOwnedDefinition, updateDefinition: updateRecord },
      whatsappClient: { validateSource, getDeliveryReadiness: getReadiness },
      now: (): string => NOW,
    },
  };
}
