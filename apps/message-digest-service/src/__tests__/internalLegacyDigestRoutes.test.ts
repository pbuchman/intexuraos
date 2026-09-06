import type { FastifyInstance } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '../domain/models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../domain/models/messageDigestRun.js';
import type { MessageDigestStore } from '../domain/ports/messageDigestStore.js';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    validateInternalAuth: vi.fn(() => ({ valid: true })),
    logIncomingRequest: vi.fn(),
  };
});

describe('legacy Message Digest internal routes', () => {
  let app: FastifyInstance;
  let getDefinition: ReturnType<
    typeof vi.fn<MessageDigestStore['getOwnedDefinitionByLegacyAlias']>
  >;
  let listRuns: ReturnType<typeof vi.fn<MessageDigestStore['listOwnedLegacyRuns']>>;

  beforeEach(async () => {
    vi.mocked(validateInternalAuth).mockReturnValue({ valid: true });
    vi.mocked(logIncomingRequest).mockClear();
    getDefinition = vi.fn(async () => definition());
    listRuns = vi.fn(async () => ({ items: [run()], nextCursor: null }));
    setServices(fakeServices({
      getOwnedDefinitionByLegacyAlias: getDefinition,
      listOwnedLegacyRuns: listRuns,
    }));
    app = await buildServer({ healthChecks: [] });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    vi.clearAllMocks();
  });

  it('documents both exact internal query paths', async () => {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.json().paths).toMatchObject({
      '/internal/message-digests/definitions/query': expect.any(Object),
      '/internal/message-digests/runs/query': expect.any(Object),
    });
  });

  it('returns one safe group definition projection and never private definition content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/definitions/query',
      payload: aliasBody(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
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
      },
    });
    expect(response.body).not.toContain('Private fishing prompt');
    expect(response.body).not.toContain('Synthetic fishing group');
    expect(getDefinition).toHaveBeenCalledWith(aliasBody());
  });

  it('returns a bounded safe run page and forwards no terms to Firestore', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/runs/query',
      payload: {
        ...aliasBody(),
        fromDate: '2026-07-27',
        toDate: '2026-07-27',
        terms: ['catch'],
        limit: 25,
        cursor: 'opaque-cursor',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            definitionId: 'md_definition_001',
            runId: 'mdr_run_001',
            legacyGroupKey: 'synthetic-fishing-group',
            date: '2026-07-27',
            title: 'Fishing plans',
            summaryMarkdown: '- The catch was strong.',
            messageCount: 12,
            evidenceMessageRefs: ['synthetic-message-ref-001'],
          },
        ],
        truncated: false,
        nextCursor: null,
      },
    });
    expect(listRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        activeMigrationId: 'mdm_migration_001',
        cursor: 'opaque-cursor',
        limit: 25,
      })
    );
    expect(listRuns.mock.calls[0]?.[0]).not.toHaveProperty('terms');
    expect(response.body).not.toContain('Private continuity');
  });

  it('makes a missing alias, direct definition, and staged run absent', async () => {
    getDefinition
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        definition({ source: { ...definition().source, chatType: 'direct' } })
      )
      .mockResolvedValueOnce(definition());
    listRuns.mockResolvedValueOnce({
      items: [run({ visibilityMigrationId: 'mdm_migration_001' })],
      nextCursor: null,
    });

    const missing = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/definitions/query',
      payload: aliasBody(),
    });
    const direct = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/definitions/query',
      payload: aliasBody(),
    });
    const staged = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/runs/query',
      payload: { ...aliasBody(), limit: 25 },
    });

    expect(missing.json()).toMatchObject({ success: true, data: { items: [] } });
    expect(direct.json()).toMatchObject({ success: true, data: { items: [] } });
    expect(staged.json()).toMatchObject({ success: true, data: { items: [] } });
  });

  it('requires internal auth before querying either route', async () => {
    vi.mocked(validateInternalAuth).mockReturnValue({ valid: false, reason: 'token_mismatch' });

    for (const [url, payload] of [
      ['/internal/message-digests/definitions/query', aliasBody()],
      ['/internal/message-digests/runs/query', { ...aliasBody(), limit: 25 }],
    ] as const) {
      const response = await app.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(401);
    }
    expect(getDefinition).not.toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it.each([
    { payload: { ...aliasBody(), userId: ' ' }, route: 'definitions' },
    { payload: { ...aliasBody(), extra: true }, route: 'definitions' },
    { payload: { ...aliasBody(), limit: 0 }, route: 'runs' },
    { payload: { ...aliasBody(), limit: 101 }, route: 'runs' },
    { payload: { ...aliasBody(), limit: 25, fromDate: '2026-02-30' }, route: 'runs' },
    { payload: { ...aliasBody(), limit: 25, terms: [] }, route: 'runs' },
    { payload: { ...aliasBody(), limit: 25, terms: ['a'.repeat(101)] }, route: 'runs' },
    { payload: { ...aliasBody(), limit: 25, cursor: 'c'.repeat(4_097) }, route: 'runs' },
  ])('rejects an invalid $route request before storage', async ({ payload, route }) => {
    const response = await app.inject({
      method: 'POST',
      url: `/internal/message-digests/${route}/query`,
      payload,
    });

    expect(response.statusCode).toBe(400);
  });

  it('maps an invalid signed cursor to the stable invalid-request envelope', async () => {
    listRuns.mockRejectedValueOnce(new Error('INVALID_CURSOR'));
    const response = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/runs/query',
      payload: { ...aliasBody(), limit: 25, cursor: 'invalid-cursor' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('logs only the bounded operation label and never request body values', async () => {
    await app.inject({
      method: 'POST',
      url: '/internal/message-digests/definitions/query',
      payload: aliasBody(),
    });

    expect(logIncomingRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ bodyPreviewLength: 0 })
    );
    expect(JSON.stringify(vi.mocked(logIncomingRequest).mock.calls[0]?.[1])).not.toContain(
      'synthetic-fishing-group'
    );
  });
});

function aliasBody(): { userId: string; legacyGroupKey: string } {
  return { userId: 'synthetic-user-001', legacyGroupKey: 'synthetic-fishing-group' };
}

function fakeServices(
  store: Pick<
    MessageDigestStore,
    'getOwnedDefinitionByLegacyAlias' | 'listOwnedLegacyRuns'
  >
): ServiceContainer {
  return {
    config: { webAppUrl: 'https://intexuraos.cloud' } as never,
    logger: {} as never,
    firestore: {} as never,
    whatsappServiceClient: {} as never,
    messageDigestStore: store as MessageDigestStore,
    messageDigestWhatsAppClient: {} as never,
    usageSink: {} as never,
    messageDigestAggregator: {} as never,
    pubsub: {} as never,
    messageDigestRunPublisher: { publish: vi.fn() },
    whatsappSendPublisher: { publish: vi.fn() },
    runPreparationTokens: {} as never,
  };
}

function definition(overrides: Partial<MessageDigestDefinition> = {}): MessageDigestDefinition {
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
    summaryMarkdown: '- The catch was strong.',
    evidenceMessageRefs: ['synthetic-message-ref-001'],
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
