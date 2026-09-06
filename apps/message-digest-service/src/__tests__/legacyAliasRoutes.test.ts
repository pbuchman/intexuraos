import type { FastifyInstance } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
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
    requireAuth: vi.fn(async () => ({ userId: 'synthetic-user-001', claims: {} })),
    logIncomingRequest: vi.fn(),
  };
});

describe('legacy Message Digest alias resolver route', () => {
  let app: FastifyInstance;
  let getDefinition: ReturnType<
    typeof vi.fn<MessageDigestStore['getOwnedDefinitionByLegacyAlias']>
  >;
  let listRuns: ReturnType<typeof vi.fn<MessageDigestStore['listOwnedLegacyRuns']>>;

  beforeEach(async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'synthetic-user-001', claims: {} });
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

  it('documents and resolves an owned legacy URL to canonical identifiers only', async () => {
    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApi.json().paths).toMatchObject({
      '/legacy-runs/{groupKey}/{date}': expect.any(Object),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/legacy-runs/synthetic-fishing-group/2026-07-27',
      headers: { authorization: 'Bearer synthetic-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { definitionId: 'md_definition_001', runId: 'mdr_run_001' },
    });
    expect(Object.keys(response.json().data)).toEqual(['definitionId', 'runId']);
    expect(response.body).not.toContain('Fishing plans');
    expect(response.body).not.toContain('synthetic-message-ref-001');
    expect(getDefinition).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
    });
  });

  it('requires the bearer-authenticated owner before any alias lookup', async () => {
    vi.mocked(requireAuth).mockImplementationOnce(async (_request, reply) => {
      await reply.fail('UNAUTHORIZED', 'Authentication required');
      return null;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/legacy-runs/synthetic-fishing-group/2026-07-27',
    });

    expect(response.statusCode).toBe(401);
    expect(getDefinition).not.toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for another owner, missing alias, direct definition, or staged day', async () => {
    getDefinition
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        definition({ source: { ...definition().source, chatType: 'direct' } })
      )
      .mockResolvedValueOnce(definition());
    listRuns.mockResolvedValueOnce({
      items: [run({ visibilityMigrationId: 'mdm_migration_001' })],
      nextCursor: null,
    });
    const urls = [
      '/legacy-runs/synthetic-fishing-group/2026-07-27',
      '/legacy-runs/missing-group/2026-07-27',
      '/legacy-runs/synthetic-fishing-group/2026-07-27',
      '/legacy-runs/synthetic-fishing-group/2026-07-27',
    ];

    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND' },
      });
    }
  });

  it.each([
    {
      url: '/legacy-runs/Invalid%20Alias/2026-07-27',
      statusCode: 400,
    },
    {
      url: `/legacy-runs/${'a'.repeat(129)}/2026-07-27`,
      statusCode: 404,
    },
    {
      url: '/legacy-runs/synthetic-fishing-group/not-a-date',
      statusCode: 400,
    },
  ])('rejects malformed path values before storage: $url', async ({ url, statusCode }) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(statusCode);
    expect(getDefinition).not.toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it('treats a calendar-invalid but shape-valid date as absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/legacy-runs/synthetic-fishing-group/2026-02-30',
    });

    expect(response.statusCode).toBe(404);
    expect(listRuns).not.toHaveBeenCalled();
  });

  it('logs the route template without alias, date, or response content', async () => {
    await app.inject({
      method: 'GET',
      url: '/legacy-runs/synthetic-fishing-group/2026-07-27',
    });

    expect(logIncomingRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        bodyPreviewLength: 0,
        includeHeaders: false,
        includeParams: false,
      })
    );
    expect(JSON.stringify(vi.mocked(logIncomingRequest).mock.calls.at(-1)?.[1])).not.toContain(
      'synthetic-fishing-group'
    );
  });
});

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
