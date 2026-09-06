import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  MessageDigestDefinition,
  MessageDigestState,
} from '../models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import type {
  MessageDigestRunPreparationClaims,
  MessageDigestRunPreparationTokens,
} from '../ports/runPreparationTokens.js';
import { reserveMessageDigestRun } from './reserveMessageDigestRun.js';

const CONFIRMED_AT = '2026-07-27T12:01:00.000Z';
const RUN_ID = 'mdr_e91e281a19f9cee24fbd68e346d3781326325903b1e0c59e';
const OUTBOX_ID = 'mdo_7a7f026067247872a73d001553fd4931125ecfbbb3bbf3bf';
const REQUEST_DIGEST = '909c93dc3e11fbf551970c4d328c0681c68cfc3c926c38141f8156daa36ac6e3';

describe('reserveMessageDigestRun', () => {
  it('atomically reserves the prepared manual window with deterministic identity and exact bytes', async () => {
    const harness = createHarness();

    const result = await reserveMessageDigestRun(validInput(), harness.dependencies);

    expect(harness.readToken).toHaveBeenCalledWith({
      token: 'opaque-preparation-token',
      binding: { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
    });
    expect(harness.getDeliveryReadiness).toHaveBeenCalledWith('synthetic-user-001');
    expect(harness.reserveRun).toHaveBeenCalledOnce();
    const reservation = harness.reserveRun.mock.calls[0]?.[0];
    expect(reservation).toMatchObject({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedDefinitionRevision: 3,
      expectedStateRevision: 5,
      expectedErasureEpoch: 0,
      expectedReadinessObservationVersion: 'persisted-readiness-v1',
      readinessObservation: {
        observationVersion: 'prepared-readiness-v1',
        observedAt: CONFIRMED_AT,
      },
      nextRunAt: '2026-07-28T07:00:00.000Z',
      run: {
        runId: RUN_ID,
        definitionNameSnapshot: 'Fishing daily',
        trigger: 'manual',
        requestIdDigest: REQUEST_DIGEST,
        windowStart: '2026-07-27T07:00:00.000Z',
        windowEnd: '2026-07-27T12:00:00.000Z',
        scheduledBoundary: '2026-07-27T12:00:00.000Z',
        generationStatus: 'queued',
        processingStage: 'queued',
        delivery: {
          type: 'whatsapp_primary',
          status: 'not_sent',
          idempotencyKey: `message-digest:${RUN_ID}`,
        },
        createdAt: CONFIRMED_AT,
      },
      outbox: { outboxId: OUTBOX_ID, kind: 'run_request', status: 'pending' },
    });
    if (reservation === undefined) throw new Error('Expected reservation');
    const expectedPayload = JSON.stringify({
      type: 'message-digest.run',
      version: 1,
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: RUN_ID,
      requestedAt: '2026-07-27T12:00:00.000Z',
    });
    expect(reservation.outbox.payloadJson).toBe(expectedPayload);
    expect(reservation.outbox.payloadDigest).toBe(
      createHash('sha256').update(expectedPayload, 'utf8').digest('hex')
    );
    expect(result).toMatchObject({
      ok: true,
      disposition: 'reserved',
      run: { runId: RUN_ID, definitionId: 'md_definition_001' },
    });
  });

  it('replays the same request as the same run and exact outbox bytes', async () => {
    const harness = createHarness({ replay: true });

    const first = await reserveMessageDigestRun(validInput(), harness.dependencies);
    const second = await reserveMessageDigestRun(validInput(), harness.dependencies);

    expect(first).toMatchObject({ ok: true, run: { runId: RUN_ID } });
    expect(second).toMatchObject({ ok: true, disposition: 'existing', run: { runId: RUN_ID } });
    expect(harness.reserveRun).toHaveBeenCalledTimes(2);
    expect(harness.reserveRun.mock.calls[0]?.[0].outbox.payloadJson).toBe(
      harness.reserveRun.mock.calls[1]?.[0].outbox.payloadJson
    );
  });

  it('replays a completed durable run before token, context, and readiness checks', async () => {
    const initialHarness = createHarness();
    const initial = await reserveMessageDigestRun(validInput(), initialHarness.dependencies);
    if (!initial.ok) throw new Error(initial.code);
    const completedRun: MessageDigestRun = {
      ...initial.run,
      generationStatus: 'completed',
      processingStage: 'completed',
      delivery: { ...initial.run.delivery, status: 'sent' },
      completedAt: '2026-07-27T12:03:00.000Z',
      updatedAt: '2026-07-27T12:03:00.000Z',
    };
    const replay = createHarness({
      existingRun: completedRun,
      tokenFailure: true,
      context: null,
      readinessFailure: true,
    });

    await expect(
      reserveMessageDigestRun(validInput(), replay.dependencies)
    ).resolves.toEqual({
      ok: true,
      disposition: 'existing',
      run: completedRun,
    });
    expect(replay.getOwnedRun).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: RUN_ID,
    });
    expect(replay.readToken).not.toHaveBeenCalled();
    expect(replay.getOwnedRunContext).not.toHaveBeenCalled();
    expect(replay.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(replay.reserveRun).not.toHaveBeenCalled();
  });

  it('rejects an existing deterministic run with a conflicting immutable request identity', async () => {
    const initialHarness = createHarness();
    const initial = await reserveMessageDigestRun(validInput(), initialHarness.dependencies);
    if (!initial.ok) throw new Error(initial.code);
    const conflictingRun: MessageDigestRun = {
      ...initial.run,
      requestIdDigest: 'f'.repeat(64),
    };
    const conflict = createHarness({ existingRun: conflictingRun });

    await expect(
      reserveMessageDigestRun(validInput(), conflict.dependencies)
    ).resolves.toEqual({ ok: false, code: 'RUN_PREPARATION_STALE' });
    expect(conflict.readToken).not.toHaveBeenCalled();
    expect(conflict.getOwnedRunContext).not.toHaveBeenCalled();
    expect(conflict.reserveRun).not.toHaveBeenCalled();
  });

  it('rejects an invalid, expired, or locally stale preparation without reserving', async () => {
    const invalid = createHarness({ tokenFailure: true });
    await expect(reserveMessageDigestRun(validInput(), invalid.dependencies)).resolves.toEqual({
      ok: false,
      code: 'RUN_PREPARATION_STALE',
    });
    expect(invalid.getOwnedRunContext).not.toHaveBeenCalled();
    expect(invalid.reserveRun).not.toHaveBeenCalled();

    const context = runContext();
    context.definition.revision += 1;
    const stale = createHarness({ context });
    await expect(reserveMessageDigestRun(validInput(), stale.dependencies)).resolves.toEqual({
      ok: false,
      code: 'RUN_PREPARATION_STALE',
    });
    expect(stale.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(stale.reserveRun).not.toHaveBeenCalled();
  });

  it('allows only the same pending request to reach idempotent store replay', async () => {
    const same = runContext();
    same.state.pendingWindow = pendingWindow({ runId: RUN_ID, requestIdDigest: REQUEST_DIGEST });
    same.state.revision = 6;
    const replay = createHarness({ context: same, replay: true });
    await expect(reserveMessageDigestRun(validInput(), replay.dependencies)).resolves.toMatchObject(
      {
        ok: true,
        disposition: 'existing',
        run: { runId: RUN_ID },
      }
    );
    expect(replay.reserveRun).toHaveBeenCalledOnce();

    const other = runContext();
    other.state.pendingWindow = pendingWindow({
      runId: 'mdr_other_pending_001',
      requestIdDigest: 'f'.repeat(64),
    });
    other.state.revision = 6;
    const conflict = createHarness({ context: other });
    await expect(reserveMessageDigestRun(validInput(), conflict.dependencies)).resolves.toEqual({
      ok: false,
      code: 'RUN_IN_PROGRESS',
    });
    expect(conflict.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(conflict.reserveRun).not.toHaveBeenCalled();
  });

  it('rechecks readiness and rejects a changed mapping before any reservation', async () => {
    const unavailable = createHarness({ readinessFailure: true });
    await expect(reserveMessageDigestRun(validInput(), unavailable.dependencies)).resolves.toEqual({
      ok: false,
      code: 'READINESS_UNAVAILABLE',
    });
    expect(unavailable.reserveRun).not.toHaveBeenCalled();

    const missing = createHarness({ readinessStatus: 'mapping_missing' });
    await expect(reserveMessageDigestRun(validInput(), missing.dependencies)).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_NOT_READY',
      readinessStatus: 'mapping_missing',
    });
    expect(missing.reserveRun).not.toHaveBeenCalled();

    const changed = createHarness({ readinessVersion: 'changed-readiness-v2' });
    await expect(reserveMessageDigestRun(validInput(), changed.dependencies)).resolves.toEqual({
      ok: false,
      code: 'RUN_PREPARATION_STALE',
    });
    expect(changed.reserveRun).not.toHaveBeenCalled();
  });

  it.each([
    ['REVISION_CONFLICT', 'RUN_PREPARATION_STALE'],
    ['READINESS_CHANGED', 'RUN_PREPARATION_STALE'],
    ['RUN_CONFLICT', 'RUN_PREPARATION_STALE'],
    ['RUN_IN_PROGRESS', 'RUN_IN_PROGRESS'],
    ['NOT_ACTIVE', 'NOT_ACTIVE'],
    ['NOT_FOUND', 'NOT_FOUND'],
  ] as const)('maps atomic store result %s to %s', async (storeCode, expectedCode) => {
    const harness = createHarness({ storeFailure: storeCode });

    await expect(reserveMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: expectedCode,
    });
  });

  it('rejects malformed client identity before token parsing', async () => {
    const harness = createHarness();
    await expect(
      reserveMessageDigestRun(validInput({ requestId: 'short' }), harness.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(harness.readToken).not.toHaveBeenCalled();
  });

  it('rejects every malformed boundary and an invalid confirmation time before token parsing', async () => {
    const valid = validInput();
    for (const input of [
      { ...valid, userId: ' ' },
      { ...valid, userId: 'x'.repeat(257) },
      { ...valid, definitionId: ' ' },
      { ...valid, definitionId: 'x'.repeat(257) },
      { ...valid, requestId: 'short' },
      { ...valid, requestId: 'x'.repeat(257) },
      { ...valid, preparationToken: ' ' },
      { ...valid, preparationToken: 'x'.repeat(16_385) },
    ]) {
      const harness = createHarness();
      await expect(reserveMessageDigestRun(input, harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      expect(harness.readToken).not.toHaveBeenCalled();
    }
    const invalidNow = createHarness();
    invalidNow.dependencies.now = (): string => 'not-an-instant';
    await expect(reserveMessageDigestRun(valid, invalidNow.dependencies)).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  it('uses owner-safe not-found and inactive results before readiness observation', async () => {
    const missing = createHarness({ context: null });
    await expect(reserveMessageDigestRun(validInput(), missing.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const context = runContext();
    context.definition.status = 'paused';
    const inactive = createHarness({ context });
    await expect(reserveMessageDigestRun(validInput(), inactive.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_ACTIVE',
    });
    expect(inactive.getDeliveryReadiness).not.toHaveBeenCalled();
  });
});

interface HarnessOptions {
  context?: ReturnType<typeof runContext> | null;
  replay?: boolean;
  tokenFailure?: boolean;
  readinessFailure?: boolean;
  readinessStatus?: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
  readinessVersion?: string;
  existingRun?: MessageDigestRun;
  storeFailure?:
    | 'NOT_FOUND'
    | 'NOT_ACTIVE'
    | 'REVISION_CONFLICT'
    | 'READINESS_CHANGED'
    | 'RUN_IN_PROGRESS'
    | 'RUN_CONFLICT';
}

function createHarness(options: HarnessOptions = {}): {
  dependencies: Parameters<typeof reserveMessageDigestRun>[1];
  readToken: ReturnType<typeof vi.fn<MessageDigestRunPreparationTokens['read']>>;
  getOwnedRun: ReturnType<typeof vi.fn<MessageDigestStore['getOwnedRun']>>;
  getOwnedRunContext: ReturnType<typeof vi.fn<MessageDigestStore['getOwnedRunContext']>>;
  getDeliveryReadiness: ReturnType<
    typeof vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>
  >;
  reserveRun: ReturnType<typeof vi.fn<MessageDigestStore['reserveRun']>>;
} {
  const readToken = vi.fn<MessageDigestRunPreparationTokens['read']>(() =>
    options.tokenFailure === true
      ? {
          ok: false,
          error: {
            code: 'INVALID_PREPARATION_TOKEN',
            message: 'Invalid run preparation token',
          },
        }
      : { ok: true, value: preparationClaims() }
  );
  const getOwnedRunContext = vi.fn<MessageDigestStore['getOwnedRunContext']>(async () =>
    options.context === undefined ? runContext() : options.context
  );
  const getOwnedRun = vi.fn<MessageDigestStore['getOwnedRun']>(async (input) =>
    options.existingRun?.runId === input.runId &&
    options.existingRun.userId === input.userId &&
    options.existingRun.definitionId === input.definitionId
      ? options.existingRun
      : null
  );
  const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(
    async () =>
      options.readinessFailure === true
        ? { ok: false, code: 'unavailable' }
        : {
            ok: true,
            value: {
              status: options.readinessStatus ?? 'ready',
              ...(options.readinessStatus === undefined || options.readinessStatus === 'ready'
                ? { maskedPrimaryNumber: '+48•••123' }
                : {}),
              observationVersion: options.readinessVersion ?? 'prepared-readiness-v1',
              observedAt: CONFIRMED_AT,
            },
          }
  );
  const reserveRun = vi.fn<MessageDigestStore['reserveRun']>(async (input) => {
    if (options.storeFailure !== undefined) return { ok: false, code: options.storeFailure };
    return {
      ok: true,
      disposition: options.replay === true ? 'existing' : 'reserved',
      run: input.run,
    };
  });
  const store = { getOwnedRun, getOwnedRunContext, reserveRun };
  return {
    dependencies: {
      store,
      whatsappClient: { getDeliveryReadiness },
      preparationTokens: { read: readToken },
      now: (): string => CONFIRMED_AT,
    },
    readToken,
    getOwnedRun,
    getOwnedRunContext,
    getDeliveryReadiness,
    reserveRun,
  };
}

function validInput(
  overrides: Partial<{
    requestId: string;
  }> = {}
): {
  userId: string;
  definitionId: string;
  requestId: string;
  preparationToken: string;
} {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    requestId: 'client-request-0001',
    preparationToken: 'opaque-preparation-token',
    ...overrides,
  };
}

function preparationClaims(): MessageDigestRunPreparationClaims {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    definitionRevision: 3,
    stateRevision: 5,
    erasureEpoch: 0,
    windowStart: '2026-07-27T07:00:00.000Z',
    windowEnd: '2026-07-27T12:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    persistedReadinessObservationVersion: 'persisted-readiness-v1',
    preparedReadinessObservationVersion: 'prepared-readiness-v1',
  };
}

function runContext(): {
  definition: MessageDigestDefinition;
  state: MessageDigestState;
} {
  const definition: MessageDigestDefinition = {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Fishing daily',
    nameSortKey: 'fishing daily',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 3,
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
      sourceRevision: 'opaque-source-revision',
    },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize concrete decisions, plans, catches, and follow-ups from this chat.',
      revision: '2',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'persisted-readiness-v1',
      readinessObservedAt: '2026-07-27T07:00:00.000Z',
    },
    checkpointAt: '2026-07-27T07:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'b'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T07:00:00.000Z',
    updatedAt: '2026-07-27T07:00:00.000Z',
  };
  return {
    definition,
    state: {
      version: 1,
      definitionId: definition.definitionId,
      userId: definition.userId,
      revision: 5,
      checkpointAt: definition.checkpointAt,
      continuityMemoryMarkdown: '',
      precedingRunId: null,
      precedingRunHash: null,
      pendingWindow: null,
      updatedAt: definition.updatedAt,
    },
  };
}

function pendingWindow(input: {
  runId: string;
  requestIdDigest: string;
}): NonNullable<MessageDigestState['pendingWindow']> {
  return {
    ...input,
    trigger: 'manual',
    windowStart: '2026-07-27T07:00:00.000Z',
    windowEnd: '2026-07-27T12:00:00.000Z',
    definitionRevision: 3,
    stateRevision: 5,
    erasureEpoch: 0,
    reservedAt: CONFIRMED_AT,
  };
}
