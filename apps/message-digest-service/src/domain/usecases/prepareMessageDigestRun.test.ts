import { describe, expect, it, vi } from 'vitest';
import type {
  MessageDigestDefinition,
  MessageDigestState,
} from '../models/messageDigestDefinition.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import type { MessageDigestRunPreparationTokens } from '../ports/runPreparationTokens.js';
import { prepareMessageDigestRun } from './prepareMessageDigestRun.js';

const NOW = '2026-07-27T12:00:00.000Z';

describe('prepareMessageDigestRun', () => {
  it('returns the exact open window and issues a token with every local and remote fence', async () => {
    const harness = createHarness();

    const result = await prepareMessageDigestRun(
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
      harness.dependencies
    );

    expect(harness.getOwnedRunContext).toHaveBeenCalledWith(
      'synthetic-user-001',
      'md_definition_001'
    );
    expect(harness.getDeliveryReadiness).toHaveBeenCalledWith('synthetic-user-001');
    expect(harness.issue).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      definitionRevision: 3,
      stateRevision: 5,
      erasureEpoch: 0,
      windowStart: '2026-07-27T07:00:00.000Z',
      windowEnd: NOW,
      nextRunAt: '2026-07-28T07:00:00.000Z',
      persistedReadinessObservationVersion: 'persisted-readiness-v1',
      preparedReadinessObservationVersion: 'prepared-readiness-v1',
    });
    expect(result).toEqual({
      ok: true,
      preparation: {
        token: 'opaque-run-preparation-token',
        preparedAt: NOW,
        window: {
          start: '2026-07-27T07:00:00.000Z',
          end: NOW,
          timeZone: 'Europe/Warsaw',
        },
        source: { chatType: 'group', displayName: 'Fishing friends' },
        deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '+48•••123' },
      },
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-account-001');
    expect(JSON.stringify(result)).not.toContain('prepared-readiness-v1');
    expect(JSON.stringify(result)).not.toContain('persisted-readiness-v1');
  });

  it('returns the same owner-safe not-found result for missing context', async () => {
    const harness = createHarness({ context: null });

    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_foreign_or_missing' },
        harness.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(harness.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
  });

  it.each([
    ['paused', null, 'NOT_ACTIVE'],
    ['deleting', null, 'NOT_ACTIVE'],
    ['active', 'pending', 'RUN_IN_PROGRESS'],
  ] as const)(
    'rejects lifecycle %s / pending %s before a remote call',
    async (status, pending, code) => {
      const context = runContext();
      context.definition.status = status;
      if (pending !== null) {
        context.state.pendingWindow = {
          runId: 'mdr_existing_001',
          trigger: 'manual',
          requestIdDigest: 'a'.repeat(64),
          windowStart: context.state.checkpointAt,
          windowEnd: NOW,
          definitionRevision: context.definition.revision,
          stateRevision: context.state.revision,
          erasureEpoch: context.definition.erasureEpoch,
          reservedAt: NOW,
        };
      }
      const harness = createHarness({ context });

      await expect(
        prepareMessageDigestRun(
          { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
          harness.dependencies
        )
      ).resolves.toEqual({ ok: false, code });
      expect(harness.getDeliveryReadiness).not.toHaveBeenCalled();
      expect(harness.issue).not.toHaveBeenCalled();
    }
  );

  it.each(['mapping_missing', 'disconnected', 'delivery_disabled'] as const)(
    'requires ready primary WhatsApp instead of accepting %s',
    async (status) => {
      const harness = createHarness({ readinessStatus: status });

      await expect(
        prepareMessageDigestRun(
          { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
          harness.dependencies
        )
      ).resolves.toEqual({ ok: false, code: 'DELIVERY_NOT_READY', readinessStatus: status });
      expect(harness.issue).not.toHaveBeenCalled();
    }
  );

  it('fails safely for unavailable readiness, invalid window, or token issuance', async () => {
    const unavailable = createHarness({ readinessFailure: true });
    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        unavailable.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'READINESS_UNAVAILABLE' });

    const invalidContext = runContext();
    invalidContext.state.checkpointAt = NOW;
    const invalid = createHarness({ context: invalidContext });
    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        invalid.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'NO_OPEN_WINDOW' });
    expect(invalid.issue).not.toHaveBeenCalled();

    const tokenFailure = createHarness({ tokenFailure: true });
    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        tokenFailure.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'PREPARATION_FAILED' });
  });

  it('rejects malformed identity and time inputs before reading state', async () => {
    for (const input of [
      { userId: ' ', definitionId: 'md_definition_001' },
      { userId: 'x'.repeat(257), definitionId: 'md_definition_001' },
      { userId: 'synthetic-user-001', definitionId: ' ' },
      { userId: 'synthetic-user-001', definitionId: 'x'.repeat(257) },
    ]) {
      const harness = createHarness();
      await expect(prepareMessageDigestRun(input, harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      expect(harness.getOwnedRunContext).not.toHaveBeenCalled();
    }

    const invalidNow = createHarness();
    invalidNow.dependencies.now = (): string => 'not-an-instant';
    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        invalidNow.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('rejects a closed matching checkpoint and an invalid persisted schedule', async () => {
    const closed = runContext();
    closed.definition.checkpointAt = NOW;
    closed.state.checkpointAt = NOW;
    const closedHarness = createHarness({ context: closed });
    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        closedHarness.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'NO_OPEN_WINDOW' });

    const invalidSchedule = runContext();
    invalidSchedule.definition.schedule.localTime = 'invalid';
    const invalidHarness = createHarness({ context: invalidSchedule });
    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        invalidHarness.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_SCHEDULE' });
  });

  it('omits the masked number when readiness intentionally provides none', async () => {
    const harness = createHarness({ omitMaskedNumber: true });

    await expect(
      prepareMessageDigestRun(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        harness.dependencies
      )
    ).resolves.toMatchObject({
      ok: true,
      preparation: { deliveryReadiness: { status: 'ready' } },
    });
    const result = await prepareMessageDigestRun(
      { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
      createHarness({ omitMaskedNumber: true }).dependencies
    );
    expect(JSON.stringify(result)).not.toContain('maskedPrimaryNumber');
  });
});

interface HarnessOptions {
  context?: ReturnType<typeof runContext> | null;
  readinessStatus?: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
  readinessFailure?: boolean;
  tokenFailure?: boolean;
  omitMaskedNumber?: boolean;
}

function createHarness(options: HarnessOptions = {}): {
  dependencies: Parameters<typeof prepareMessageDigestRun>[1];
  getOwnedRunContext: ReturnType<typeof vi.fn<MessageDigestStore['getOwnedRunContext']>>;
  getDeliveryReadiness: ReturnType<
    typeof vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>
  >;
  issue: ReturnType<typeof vi.fn<MessageDigestRunPreparationTokens['issue']>>;
} {
  const getOwnedRunContext = vi.fn<MessageDigestStore['getOwnedRunContext']>(async () =>
    options.context === undefined ? runContext() : options.context
  );
  const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(
    async () =>
      options.readinessFailure === true
        ? { ok: false, code: 'unavailable' }
        : {
            ok: true,
            value: {
              status: options.readinessStatus ?? 'ready',
              ...((options.readinessStatus === undefined || options.readinessStatus === 'ready') &&
              options.omitMaskedNumber !== true
                ? { maskedPrimaryNumber: '+48•••123' }
                : {}),
              observationVersion: 'prepared-readiness-v1',
              observedAt: NOW,
            },
          }
  );
  const issue = vi.fn<MessageDigestRunPreparationTokens['issue']>(() =>
    options.tokenFailure === true
      ? {
          ok: false,
          error: {
            code: 'INVALID_PREPARATION_TOKEN',
            message: 'Invalid run preparation token',
          },
        }
      : { ok: true, value: 'opaque-run-preparation-token' }
  );
  return {
    dependencies: {
      store: { getOwnedRunContext },
      whatsappClient: { getDeliveryReadiness },
      preparationTokens: { issue },
      now: (): string => NOW,
    },
    getOwnedRunContext,
    getDeliveryReadiness,
    issue,
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
