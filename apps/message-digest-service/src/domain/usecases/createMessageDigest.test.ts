import { describe, expect, it, vi, type Mock } from 'vitest';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import { createMessageDigest } from './createMessageDigest.js';

const NOW = '2026-07-27T12:00:00.000Z';

interface CreateHarnessOptions {
  chatType?: 'group' | 'direct';
  displayName?: string;
  readinessStatus?: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
  sourceFailure?: 'not_found' | 'unavailable';
  readinessFailure?: 'unavailable';
  existingDefinition?: MessageDigestDefinition;
}

interface CreateHarness {
  validateSource: Mock<MessageDigestWhatsAppClient['validateSource']>;
  getReadiness: Mock<MessageDigestWhatsAppClient['getDeliveryReadiness']>;
  getExisting: Mock<MessageDigestStore['getOwnedDefinition']>;
  createRecord: Mock<Pick<MessageDigestStore, 'createDefinition'>['createDefinition']>;
  deps: Parameters<typeof createMessageDigest>[1];
}

describe('createMessageDigest', () => {
  it.each([
    ['group', 'Fishing friends'],
    ['direct', 'Synthetic contact'],
  ] as const)(
    'creates an active daily %s digest from a validated private source',
    async (chatType, displayName) => {
      const harness = createHarness({ chatType, displayName });

      const result = await createMessageDigest(createInput('client-request-0001'), harness.deps);

      expect(result).toMatchObject({
        ok: true,
        disposition: 'created',
        activationAdjusted: null,
        definition: {
          status: 'active',
          listStatus: 'active',
          source: {
            type: 'private_whatsapp',
            chatType,
            displayName,
            messageCount: 123,
            ...(chatType === 'group' ? { participantCount: 8 } : {}),
            lastActivityAt: '2026-07-27T11:00:00.000Z',
          },
          checkpointAt: '2026-07-27T07:00:00.000Z',
          nextRunAt: '2026-07-28T07:00:00.000Z',
        },
      });
      expect(harness.createRecord).toHaveBeenCalledOnce();
      expect(harness.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          definition: expect.objectContaining({
            definitionId: expect.stringMatching(/^md_[A-Za-z0-9_-]+$/u),
            createRequestIdDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
            instructions: {
              templateId: 'custom',
              text: 'Summarize the important decisions and follow-ups from this chat.',
              revision: '1',
            },
            delivery: {
              type: 'whatsapp_primary',
              readinessObservationVersion: 'ready-v1',
              readinessObservedAt: NOW,
            },
          }),
          state: expect.objectContaining({
            checkpointAt: '2026-07-27T07:00:00.000Z',
            continuityMemoryMarkdown: '',
            pendingWindow: null,
          }),
        })
      );
    }
  );

  it('accepts an 80-character normalized name and rejects 81 characters before downstream work', async () => {
    const accepted = createHarness();
    await expect(
      createMessageDigest(
        { ...createInput('client-request-name-0080'), name: `  ${'n'.repeat(80)}  ` },
        accepted.deps
      )
    ).resolves.toMatchObject({ ok: true, definition: { name: 'n'.repeat(80) } });

    const rejected = createHarness();
    await expect(
      createMessageDigest(
        { ...createInput('client-request-name-0081'), name: 'n'.repeat(81) },
        rejected.deps
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(rejected.getExisting).not.toHaveBeenCalled();
    expect(rejected.validateSource).not.toHaveBeenCalled();
  });

  it('allows multiple definitions for the same chat when client request IDs differ', async () => {
    const harness = createHarness();

    const first = await createMessageDigest(createInput('client-request-0001'), harness.deps);
    const second = await createMessageDigest(createInput('client-request-0002'), harness.deps);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Expected two created digests');
    expect(first.definition.definitionId).not.toBe(second.definition.definitionId);
    expect(harness.createRecord).toHaveBeenCalledTimes(2);
  });

  it('binds a weekly weekday into the durable create request identity', async () => {
    const weeklyInput = {
      ...createInput('client-request-weekly-0001'),
      schedule: {
        kind: 'weekly' as const,
        weekday: 'monday' as const,
        localTime: '09:00',
        timeZone: 'Europe/Warsaw',
      },
    };
    const initialHarness = createHarness();
    const initial = await createMessageDigest(weeklyInput, initialHarness.deps);
    expect(initial).toMatchObject({
      ok: true,
      definition: { schedule: { kind: 'weekly', weekday: 'monday' } },
    });
    if (!initial.ok) throw new Error(initial.code);

    const replay = createHarness({ existingDefinition: initial.definition });
    await expect(createMessageDigest(weeklyInput, replay.deps)).resolves.toMatchObject({
      ok: true,
      disposition: 'existing',
    });
    await expect(
      createMessageDigest(
        {
          ...weeklyInput,
          schedule: { ...weeklyInput.schedule, weekday: 'tuesday' as const },
        },
        replay.deps
      )
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });
  });

  it('replays the durable create result before mutable WhatsApp checks and rejects substitution', async () => {
    const initialHarness = createHarness();
    const initial = await createMessageDigest(
      createInput('client-request-replay-0001'),
      initialHarness.deps
    );
    if (!initial.ok) throw new Error(initial.code);

    const replay = createHarness({
      existingDefinition: initial.definition,
      sourceFailure: 'unavailable',
      readinessFailure: 'unavailable',
    });
    await expect(
      createMessageDigest(createInput('client-request-replay-0001'), replay.deps)
    ).resolves.toEqual({
      ok: true,
      disposition: 'existing',
      activationAdjusted: null,
      definition: initial.definition,
    });
    expect(replay.validateSource).not.toHaveBeenCalled();
    expect(replay.getReadiness).not.toHaveBeenCalled();
    expect(replay.createRecord).not.toHaveBeenCalled();

    const substitution = createHarness({ existingDefinition: initial.definition });
    await expect(
      createMessageDigest(
        { ...createInput('client-request-replay-0001'), name: 'Substituted name' },
        substitution.deps
      )
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });
    expect(substitution.validateSource).not.toHaveBeenCalled();
    expect(substitution.getReadiness).not.toHaveBeenCalled();
    expect(substitution.createRecord).not.toHaveBeenCalled();

    const statusSubstitution = createHarness({ existingDefinition: initial.definition });
    await expect(
      createMessageDigest(
        { ...createInput('client-request-replay-0001'), status: 'paused' },
        statusSubstitution.deps
      )
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });
    expect(statusSubstitution.validateSource).not.toHaveBeenCalled();
    expect(statusSubstitution.getReadiness).not.toHaveBeenCalled();
    expect(statusSubstitution.createRecord).not.toHaveBeenCalled();
  });

  it.each(['mapping_missing', 'disconnected', 'delivery_disabled'] as const)(
    'creates paused needs-attention state when delivery readiness is %s',
    async (status) => {
      const harness = createHarness({ readinessStatus: status });

      const result = await createMessageDigest(createInput('client-request-0001'), harness.deps);

      expect(result).toMatchObject({
        ok: true,
        activationAdjusted: 'delivery_setup_required',
        definition: {
          status: 'paused',
          listStatus: 'needs_attention',
          attentionCode: 'DELIVERY_SETUP_REQUIRED',
        },
      });
    }
  );

  it('preserves an explicitly paused request when delivery is ready', async () => {
    const harness = createHarness();

    await expect(
      createMessageDigest(
        { ...createInput('client-request-paused-0001'), status: 'paused' },
        harness.deps
      )
    ).resolves.toMatchObject({
      ok: true,
      activationAdjusted: null,
      definition: {
        status: 'paused',
        listStatus: 'paused',
        attentionCode: null,
      },
    });
  });

  it('requires a closed active or paused create status before downstream work', async () => {
    for (const input of [
      { ...createInput('client-request-status-0001'), status: undefined },
      { ...createInput('client-request-status-0002'), status: 'deleting' },
    ]) {
      const harness = createHarness();
      await expect(
        createMessageDigest(
          input as unknown as Parameters<typeof createMessageDigest>[0],
          harness.deps
        )
      ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
      expect(harness.getExisting).not.toHaveBeenCalled();
      expect(harness.validateSource).not.toHaveBeenCalled();
    }
  });

  it('fails safely without writing when the private source cannot be validated', async () => {
    const harness = createHarness({ sourceFailure: 'not_found' });

    await expect(
      createMessageDigest(createInput('client-request-0001'), harness.deps)
    ).resolves.toEqual({
      ok: false,
      code: 'SOURCE_NOT_FOUND',
    });
    expect(harness.createRecord).not.toHaveBeenCalled();
    expect(harness.getReadiness).not.toHaveBeenCalled();
  });

  it('rejects an unavailable readiness observation and an invalid schedule without writing', async () => {
    const unavailable = createHarness({ readinessFailure: 'unavailable' });
    await expect(
      createMessageDigest(createInput('client-request-0001'), unavailable.deps)
    ).resolves.toEqual({ ok: false, code: 'READINESS_UNAVAILABLE' });
    expect(unavailable.createRecord).not.toHaveBeenCalled();

    const invalid = createHarness();
    await expect(
      createMessageDigest(
        {
          ...createInput('client-request-0002'),
          schedule: { kind: 'daily', localTime: '25:00', timeZone: 'UTC' },
        },
        invalid.deps
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_SCHEDULE' });
    expect(invalid.validateSource).not.toHaveBeenCalled();
    expect(invalid.createRecord).not.toHaveBeenCalled();
  });

  it('maps unavailable source validation and a store conflict without leaking details', async () => {
    const unavailable = createHarness({ sourceFailure: 'unavailable' });
    await expect(
      createMessageDigest(createInput('client-request-0001'), unavailable.deps)
    ).resolves.toEqual({ ok: false, code: 'SOURCE_UNAVAILABLE' });

    const conflict = createHarness();
    conflict.createRecord.mockResolvedValueOnce({ ok: false, code: 'CREATE_CONFLICT' });
    await expect(
      createMessageDigest(createInput('client-request-0002'), conflict.deps)
    ).resolves.toEqual({ ok: false, code: 'CREATE_CONFLICT' });
  });

  it('rejects invalid normalized fields and timestamps before any downstream write', async () => {
    const invalidInputs: Parameters<typeof createMessageDigest>[0][] = [
      { ...createInput('client-request-0001'), userId: ' ' },
      { ...createInput('short'), requestId: 'short' },
      { ...createInput('client-request-0001'), requestId: 'x'.repeat(257) },
      { ...createInput('client-request-0001'), name: ' ' },
      { ...createInput('client-request-0001'), name: 'x'.repeat(81) },
      { ...createInput('client-request-0001'), source: { chatId: ' ' } },
      {
        ...createInput('client-request-0001'),
        instructions: { templateId: 'custom', text: 'too short' },
      },
      {
        ...createInput('client-request-0001'),
        instructions: { templateId: 'custom', text: 'x'.repeat(4_001) },
      },
    ];
    for (const input of invalidInputs) {
      const harness = createHarness();
      await expect(createMessageDigest(input, harness.deps)).resolves.toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      expect(harness.validateSource).not.toHaveBeenCalled();
    }

    const invalidNow = createHarness();
    invalidNow.deps.now = (): string => 'not-an-instant';
    await expect(
      createMessageDigest(createInput('client-request-0001'), invalidNow.deps)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });
});

function createInput(requestId: string): Parameters<typeof createMessageDigest>[0] {
  return {
    userId: 'synthetic-user-001',
    requestId,
    status: 'active',
    name: 'Daily chat summary',
    source: { chatId: 'synthetic-chat-001' },
    instructions: {
      templateId: 'custom' as const,
      text: 'Summarize the important decisions and follow-ups from this chat.',
    },
    schedule: { kind: 'daily' as const, localTime: '09:00', timeZone: 'Europe/Warsaw' },
  };
}

function createHarness(options: CreateHarnessOptions = {}): CreateHarness {
  const validateSource = vi.fn<MessageDigestWhatsAppClient['validateSource']>(async () =>
    options.sourceFailure === undefined
      ? {
          ok: true,
          value: {
            sourceAccountId: 'synthetic-account-001',
            generationId: 'synthetic-generation-001',
            chatId: 'synthetic-chat-001',
            chatType: options.chatType ?? 'group',
            displayName: options.displayName ?? 'Fishing friends',
            messageCount: 123,
            ...(options.chatType === 'direct' ? {} : { participantCount: 8 }),
            lastActivityAt: '2026-07-27T11:00:00.000Z',
            sourceRevision: 'synthetic-source-revision-001',
          },
        }
      : { ok: false, code: options.sourceFailure }
  );
  const getReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(async () =>
    options.readinessFailure === undefined
      ? {
          ok: true,
          value: {
            status: options.readinessStatus ?? 'ready',
            observationVersion: 'ready-v1',
            observedAt: NOW,
          },
        }
      : { ok: false, code: options.readinessFailure }
  );
  const createRecord = vi.fn<Pick<MessageDigestStore, 'createDefinition'>['createDefinition']>(
    async ({ definition }) => ({
      ok: true,
      disposition: 'created',
      definition,
    })
  );
  const getExisting = vi.fn<MessageDigestStore['getOwnedDefinition']>(async () =>
    options.existingDefinition ?? null
  );
  const store = { createDefinition: createRecord, getOwnedDefinition: getExisting };
  return {
    validateSource,
    getReadiness,
    getExisting,
    createRecord,
    deps: {
      store,
      whatsappClient: { validateSource, getDeliveryReadiness: getReadiness },
      now: (): string => NOW,
    },
  };
}
