import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeFirestore,
  type FakeFirestore,
  type Firestore,
} from '@intexuraos/infra-firestore';
import {
  createFishingMigrationFirestorePorts,
  createFishingMigrationAggregator,
  createFishingMigrationSourcePort,
  buildFishingMigrationAggregatePrompt,
  buildFishingMigrationRepairPrompt,
  buildFishingMigrationSynthesisPrompt,
} from '../message-digests/fishing-group-production-ports.mjs';
import { buildMessageDigestAggregatePrompt } from '../../packages/llm-prompts/src/message-digest/aggregatePrompt.js';
import { buildMessageDigestRepairPrompt } from '../../packages/llm-prompts/src/message-digest/repairPrompt.js';
import { buildMessageDigestSynthesisPrompt } from '../../packages/llm-prompts/src/message-digest/synthesisPrompt.js';

interface ReplaySourceMessage {
  messageRef: string;
  eventTimestamp: string;
  direction: 'inbound';
  authorLabel: string;
  text: string;
  contentKind: 'text';
}

interface ReplayAggregateInput {
  migrationId: string;
  definitionId: string;
  userId: string;
  date: string;
  chatType: 'group';
  conversationLabel: string;
  windowStart: string;
  windowEnd: string;
  instructions: string;
  continuityMemoryMarkdown: string;
  previousSummaries: unknown[];
  messages: ReplaySourceMessage[];
}

interface MigrationSource extends Record<string, unknown> {
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: string;
  displayName: string;
  messageCount: number;
  lastActivityAt: string;
  sourceRevision: string;
}

interface MigrationDefinition extends Record<string, unknown> {
  source: MigrationSource;
}

interface MigrationState extends Record<string, unknown> {
  checkpointAt: string;
  precedingRunId: string | null;
  precedingRunHash: string | null;
  updatedAt: string;
}

interface MigrationShell {
  definition: MigrationDefinition;
  state: MigrationState;
  activation: Record<string, unknown>;
}

interface CanonicalRun extends Record<string, unknown> {
  runId: string;
  runHash: string;
  windowEnd: string;
  completedAt: string;
}

describe('fishing migration Private WhatsApp source port', () => {
  it('uses exact strict internal request bodies and returns only response data', async () => {
    const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
    const fetchImplementation = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(url), init: init ?? {}, body });
      if (String(url).endsWith('/validate')) {
        return jsonResponse({
          success: true,
          data: validatedSource(),
        });
      }
      if (String(url).endsWith('/delivery-readiness/get')) {
        return jsonResponse({
          success: true,
          data: {
            status: 'ready',
            maskedPrimaryNumber: '+48•••123',
            observationVersion: 'readiness-v1',
            observedAt: '2026-07-28T11:59:00.000Z',
          },
        });
      }
      if (String(url).endsWith('/outbound-deliveries/get')) {
        return jsonResponse({ success: true, data: { status: 'missing' } });
      }
      return jsonResponse({
        success: true,
        data: {
          messages: [],
          sourceRevision: 'private-revision',
          highWatermark: null,
          nextCursor: null,
        },
      });
    });
    const source = createFishingMigrationSourcePort({
      baseUrl: 'https://whatsapp.internal.example/',
      internalAuthToken: 'private-internal-token',
      fetchImplementation,
    });

    await expect(
      source.resolveBinding({
        userId: 'owner-001',
        sourceAccountId: 'account-001',
        generationId: 'generation-001',
        chatId: 'chat-001',
        groupDisplayName: 'Fishing Group',
      })
    ).resolves.toEqual([validatedSource()]);
    await expect(source.getReadiness({ userId: 'owner-001' })).resolves.toMatchObject({
      status: 'ready',
      observationVersion: 'readiness-v1',
    });
    await expect(
      source.getDeliveryState({
        userId: 'owner-001',
        idempotencyKey: 'message-digest:mdr_a',
      })
    ).resolves.toEqual({ status: 'missing' });
    await expect(
      source.queryMessages({
        date: '2026-07-27',
        userId: 'owner-001',
        sourceAccountId: 'account-001',
        generationId: 'generation-001',
        chatId: 'chat-001',
        chatType: 'group',
        windowStart: '2026-07-26T22:00:00.000Z',
        windowEnd: '2026-07-27T22:00:00.000Z',
        limit: 200,
        cursor: 'opaque-cursor',
      })
    ).resolves.toEqual({
      messages: [],
      sourceRevision: 'private-revision',
      highWatermark: null,
      nextCursor: null,
    });

    expect(requests.map((request) => request.body)).toEqual([
      { userId: 'owner-001', chatId: 'chat-001', expectedGenerationId: 'generation-001' },
      { userId: 'owner-001' },
      { userId: 'owner-001', idempotencyKey: 'message-digest:mdr_a' },
      {
        userId: 'owner-001',
        sourceAccountId: 'account-001',
        generationId: 'generation-001',
        chatId: 'chat-001',
        chatType: 'group',
        windowStart: '2026-07-26T22:00:00.000Z',
        windowEnd: '2026-07-27T22:00:00.000Z',
        limit: 200,
        cursor: 'opaque-cursor',
      },
    ]);
    for (const request of requests) {
      expect(request.init.method).toBe('POST');
      expect(new Headers(request.init.headers).get('x-internal-auth')).toBe(
        'private-internal-token'
      );
    }
  });

  it('fails with a content-free error for non-success, malformed, or oversized responses', async () => {
    const privateResponse = 'private-response-body-sentinel';
    const source = createFishingMigrationSourcePort({
      baseUrl: 'https://whatsapp.internal.example',
      internalAuthToken: 'private-internal-token',
      fetchImplementation: vi.fn(async () => new Response(privateResponse, { status: 500 })),
    });

    const error = await source
      .getReadiness({ userId: 'private-owner-sentinel' })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: 'MIGRATION_HTTP_REQUEST_FAILED' });
    expect(JSON.stringify(error)).not.toContain(privateResponse);
    expect(JSON.stringify(error)).not.toContain('private-owner-sentinel');
  });
});

describe('fishing migration replay aggregator', () => {
  it('keeps aggregate, synthesis, and repair prompts byte-identical to the runtime builders', () => {
    const input = aggregateInput();
    const aggregate = {
      headline: 'Synthetic headline',
      summaryMarkdown: '- Synthetic fact',
      evidenceMessageRefs: [SOURCE_REF],
      continuityMemoryMarkdown: 'Synthetic continuity',
    };
    const repairInput = {
      originalPrompt: 'Synthetic original prompt',
      invalidResponse: 'Synthetic invalid response',
      errorMessage: 'Synthetic validation error',
      allowedEvidenceMessageRefs: [SOURCE_REF],
    };

    expect(buildFishingMigrationAggregatePrompt(input)).toBe(
      buildMessageDigestAggregatePrompt(input)
    );
    expect(
      buildFishingMigrationSynthesisPrompt({
        ...input,
        chunkAggregates: [aggregate],
      })
    ).toBe(
      buildMessageDigestSynthesisPrompt({
        ...input,
        chunkAggregates: [aggregate],
      })
    );
    expect(buildFishingMigrationRepairPrompt(repairInput)).toBe(
      buildMessageDigestRepairPrompt(repairInput)
    );
  });

  it('uses strict OpenRouter JSON schema and synchronously records owner usage', async () => {
    const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
    const fetchImplementation = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(url), init: init ?? {}, body });
      if (String(url).includes('openrouter.ai')) {
        return jsonResponse(
          openRouterResponse({
            headline: 'Wędkarskie ustalenia',
            summaryMarkdown: '- Ustalono termin spotkania.',
            evidenceMessageRefs: [SOURCE_REF],
            continuityMemoryMarkdown: 'Termin pozostaje aktualny.',
          })
        );
      }
      return jsonResponse({ success: true, data: { accepted: 1 } });
    });
    const aggregate = createFishingMigrationAggregator({
      apiKey: 'private-openrouter-key',
      model: 'anthropic/synthetic-model',
      usageServiceUrl: 'https://usage.internal.example',
      internalAuthToken: 'private-internal-token',
      fetchImplementation,
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
      now: () => '2026-07-28T12:00:00.000Z',
      environment: 'prod',
    });

    await expect(aggregate(aggregateInput())).resolves.toEqual({
      headline: 'Wędkarskie ustalenia',
      summaryMarkdown: '- Ustalono termin spotkania.',
      evidenceMessageRefs: [SOURCE_REF],
      continuityMemoryMarkdown: 'Termin pozostaje aktualny.',
      promptVersion: 'message-digest-aggregate@2.1.0',
      model: 'anthropic/synthetic-model',
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125, costUsd: 0.0042 },
    });

    expect(requests).toHaveLength(2);
    const openRouter = requests[0];
    expect(openRouter?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(new Headers(openRouter?.init.headers).get('authorization')).toBe(
      'Bearer private-openrouter-key'
    );
    expect(openRouter?.body).toMatchObject({
      model: 'anthropic/synthetic-model',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'message_digest_aggregate', strict: true },
      },
      provider: { require_parameters: true },
    });
    const usage = requests[1];
    expect(usage?.url).toBe('https://usage.internal.example/internal/usage/events');
    expect(new Headers(usage?.init.headers).get('x-internal-auth')).toBe('private-internal-token');
    expect(usage?.body).toMatchObject({
      schemaVersion: 2,
      events: [
        {
          schemaVersion: 2,
          eventId: '00000000-0000-4000-8000-000000000001',
          owner: { type: 'user', id: 'owner-001' },
          source: {
            service: 'message-digest-service',
            component: 'message-digest',
            environment: 'prod',
          },
          request: {
            provider: 'openrouter',
            model: 'anthropic/synthetic-model',
            operation: 'generate',
            success: true,
            promptType: 'message-digest-aggregate',
          },
          correlation: { requestId: 'mdm_release_001:2026-07-27:aggregate' },
        },
      ],
    });
  });

  it('normalizes an internal OpenRouter selector before provider and usage requests', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const aggregate = createFishingMigrationAggregator({
      apiKey: 'private-openrouter-key',
      model: 'or:google/gemini-3-flash-preview',
      usageServiceUrl: 'https://usage.internal.example',
      internalAuthToken: 'private-internal-token',
      fetchImplementation: vi.fn(async (url: string | URL, init?: RequestInit) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        if (String(url).includes('openrouter.ai')) {
          return jsonResponse(
            openRouterResponse({
              headline: 'Wędkarskie ustalenia',
              summaryMarkdown: '- Ustalono termin spotkania.',
              evidenceMessageRefs: [SOURCE_REF],
              continuityMemoryMarkdown: 'Termin pozostaje aktualny.',
            })
          );
        }
        return jsonResponse({ success: true, data: { accepted: 1 } });
      }),
      randomUUID: () => '00000000-0000-4000-8000-000000000005',
      now: () => '2026-07-28T12:00:00.000Z',
      environment: 'prod',
    });

    await expect(aggregate(aggregateInput())).resolves.toMatchObject({
      model: 'or:google/gemini-3-flash-preview',
    });
    expect(requests[0]?.body).toMatchObject({ model: 'google/gemini-3-flash-preview' });
    expect(requests[1]?.body).toMatchObject({
      events: [{ request: { model: 'google/gemini-3-flash-preview' } }],
    });
  });

  it('chunks a large safe day, synthesizes it once, and accounts for every provider call', async () => {
    const input = aggregateInput();
    const firstMessage = required(input.messages[0]);
    input.messages = [
      { ...firstMessage, text: 'x'.repeat(31_000) },
      {
        ...firstMessage,
        messageRef: SOURCE_REF_2,
        eventTimestamp: '2026-07-27T11:00:00.000Z',
        text: 'y'.repeat(31_000),
      },
    ];
    const responses = [
      {
        headline: 'Pierwsza część',
        summaryMarkdown: '- Fakt z pierwszej części.',
        evidenceMessageRefs: [SOURCE_REF],
        continuityMemoryMarkdown: 'Pierwsza ciągłość.',
      },
      {
        headline: 'Druga część',
        summaryMarkdown: '- Fakt z drugiej części.',
        evidenceMessageRefs: [SOURCE_REF_2],
        continuityMemoryMarkdown: 'Druga ciągłość.',
      },
      {
        headline: 'Cały dzień',
        summaryMarkdown: '- Oba fakty zostały połączone.',
        evidenceMessageRefs: [SOURCE_REF, SOURCE_REF_2],
        continuityMemoryMarkdown: 'Połączona ciągłość.',
      },
    ];
    let openRouterCalls = 0;
    let usageCalls = 0;
    const aggregate = createFishingMigrationAggregator({
      apiKey: 'private-openrouter-key',
      model: 'anthropic/synthetic-model',
      usageServiceUrl: 'https://usage.internal.example',
      internalAuthToken: 'private-internal-token',
      fetchImplementation: vi.fn(async (url: string | URL) => {
        if (!String(url).includes('openrouter.ai')) {
          usageCalls += 1;
          return jsonResponse({ success: true, data: { accepted: 1 } });
        }
        const response = required(responses[openRouterCalls]);
        openRouterCalls += 1;
        return jsonResponse(openRouterResponse(response));
      }),
      randomUUID: () => '00000000-0000-4000-8000-000000000004',
      now: () => '2026-07-28T12:00:00.000Z',
      environment: 'prod',
    });

    await expect(aggregate(input)).resolves.toMatchObject({
      headline: 'Cały dzień',
      evidenceMessageRefs: [SOURCE_REF, SOURCE_REF_2],
      promptVersion: 'message-digest-synthesis@1.1.0',
      usage: { inputTokens: 300, outputTokens: 75, totalTokens: 375, costUsd: 0.0126 },
    });
    expect(openRouterCalls).toBe(3);
    expect(usageCalls).toBe(3);
  });

  it('performs exactly one bounded repair and rejects a second invalid result', async () => {
    const responses = [
      openRouterResponse({
        headline: 'Invalid',
        summaryMarkdown: '- Invalid unknown evidence.',
        evidenceMessageRefs: ['f'.repeat(64)],
        continuityMemoryMarkdown: '',
      }),
      openRouterResponse({
        headline: 'Still invalid',
        summaryMarkdown: 'https://unsafe.example',
        evidenceMessageRefs: [SOURCE_REF],
        continuityMemoryMarkdown: '',
      }),
    ];
    let openRouterCalls = 0;
    const aggregate = createFishingMigrationAggregator({
      apiKey: 'private-openrouter-key',
      model: 'anthropic/synthetic-model',
      usageServiceUrl: 'https://usage.internal.example',
      internalAuthToken: 'private-internal-token',
      fetchImplementation: vi.fn(async (url: string | URL) => {
        if (!String(url).includes('openrouter.ai')) {
          return jsonResponse({ success: true, data: { accepted: 1 } });
        }
        const response = responses[openRouterCalls];
        openRouterCalls += 1;
        return jsonResponse(response);
      }),
      randomUUID: () => '00000000-0000-4000-8000-000000000002',
      now: () => '2026-07-28T12:00:00.000Z',
      environment: 'prod',
    });

    await expect(aggregate(aggregateInput())).rejects.toThrow('MIGRATION_AGGREGATE_INVALID');
    expect(openRouterCalls).toBe(2);
  });

  it('rejects source beyond the bounded character budget before any provider call', async () => {
    const fetchImplementation = vi.fn();
    const aggregate = createFishingMigrationAggregator({
      apiKey: 'private-openrouter-key',
      model: 'anthropic/synthetic-model',
      usageServiceUrl: 'https://usage.internal.example',
      internalAuthToken: 'private-internal-token',
      fetchImplementation,
      randomUUID: () => '00000000-0000-4000-8000-000000000003',
      now: () => '2026-07-28T12:00:00.000Z',
      environment: 'prod',
    });
    const input = aggregateInput();
    input.messages = [{ ...required(input.messages[0]), text: 'x'.repeat(240_001) }];

    await expect(aggregate(input)).rejects.toThrow('MIGRATION_SOURCE_TOO_LARGE');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('fishing migration Firestore ports', () => {
  let fake: FakeFirestore;

  beforeEach(() => {
    fake = createFakeFirestore();
  });

  it('reads the exact owner/group legacy snapshot without normalization', async () => {
    fake.seedCollection('notification_daily_digests', [
      {
        id: 'digest-b',
        data: legacyData({ date: '2026-07-02', nested: { value: 'private-b' } }),
      },
      {
        id: 'digest-a',
        data: legacyData({ date: '2026-07-01', nested: { value: 'private-a' } }),
      },
      {
        id: 'digest-foreign',
        data: { ...legacyData({ date: '2026-07-01' }), userId: 'foreign-owner' },
      },
    ]);
    fake.seedCollection('notification_group_states', [
      { id: 'state-a', data: legacyData({ date: '2026-07-02', state: { topics: ['topic'] } }) },
    ]);
    fake.seedCollection('notification_digest_locks', []);
    fake.seedCollection('notification_digest_backfill_runs', []);
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });

    await expect(
      ports.archive.readSnapshot({ userId: 'owner-001', groupKey: 'fishing-group' })
    ).resolves.toEqual({
      digests: [
        {
          id: 'digest-a',
          data: legacyData({ date: '2026-07-01', nested: { value: 'private-a' } }),
        },
        {
          id: 'digest-b',
          data: legacyData({ date: '2026-07-02', nested: { value: 'private-b' } }),
        },
      ],
      states: [
        {
          id: 'state-a',
          data: legacyData({ date: '2026-07-02', state: { topics: ['topic'] } }),
        },
      ],
      locks: [],
      backfills: [],
    });
  });

  it('counts only deterministic migration delivery effects', async () => {
    fake.seedCollection('message_digest_runs', [
      migrationRun('mdr_a'),
      migrationRun('mdr_b'),
      {
        id: 'mdr_foreign',
        data: { ...migrationRun('mdr_foreign').data, definitionId: 'md_foreign' },
      },
    ]);
    fake.seedCollection('message_digest_dispatch_outbox', [
      {
        id: 'mdo_owned',
        data: { userId: 'owner-001', definitionId: 'md_definition', runId: 'mdr_a' },
      },
      {
        id: 'mdo_foreign',
        data: { userId: 'foreign-owner', definitionId: 'md_definition', runId: 'mdr_a' },
      },
    ]);
    const getDeliveryState = vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) =>
      idempotencyKey === 'message-digest:mdr_a'
        ? { status: 'sent' as const, acceptedAt: '2026-07-28T12:00:00.000Z' }
        : { status: 'missing' as const }
    );
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
      getDeliveryState,
    });

    await expect(
      ports.effects.countMigrationEffects({
        userId: 'owner-001',
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
      })
    ).resolves.toEqual({ outbox: 1, outboundMessages: 1, deliveryReceipts: 1 });
    expect(getDeliveryState).toHaveBeenCalledTimes(2);
    expect(getDeliveryState).toHaveBeenCalledWith({
      userId: 'owner-001',
      idempotencyKey: 'message-digest:mdr_a',
    });
  });

  it('creates, resumes, stages, and inspects one deterministic sequential candidate', async () => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    const shell = migrationShell();

    await expect(ports.migration.createShell(shell)).resolves.toEqual({
      disposition: 'created',
    });
    await expect(ports.migration.createShell(shell)).resolves.toEqual({
      disposition: 'existing',
    });
    const rotatedFence = structuredClone(shell);
    rotatedFence.definition.source.sourceRevision = 'private-revision-rotated';
    rotatedFence.definition.source.messageCount = 999;
    rotatedFence.definition.source.lastActivityAt = '2026-07-28T12:00:00.000Z';
    await expect(ports.migration.createShell(rotatedFence)).resolves.toEqual({
      disposition: 'existing',
    });
    const changedGeneration = structuredClone(rotatedFence);
    changedGeneration.definition.source.generationId = 'generation-changed';
    await expect(ports.migration.createShell(changedGeneration)).rejects.toThrow(
      'MIGRATION_SHELL_CONFLICT'
    );
    await expect(
      ports.migration.inspectCandidate({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
      })
    ).resolves.toEqual({
      definition: shell.definition,
      state: shell.state,
      activation: shell.activation,
      runs: [],
    });

    const first = canonicalRun('mdr_first', '2026-07-01', null, 'a'.repeat(64));
    const firstState = migrationState({
      revision: 2,
      checkpointAt: first.windowEnd,
      precedingRunId: first.runId,
      precedingRunHash: first.runHash,
      updatedAt: first.completedAt,
    });
    await expect(
      ports.migration.putCanonicalRunAndState({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        expectedPredecessorRunHash: null,
        run: first,
        state: firstState,
      })
    ).resolves.toMatchObject({ disposition: 'created', run: first });

    const second = canonicalRun('mdr_second', '2026-07-02', first.runHash, 'b'.repeat(64));
    const secondState = migrationState({
      revision: 3,
      checkpointAt: second.windowEnd,
      precedingRunId: second.runId,
      precedingRunHash: second.runHash,
      updatedAt: second.completedAt,
    });
    await expect(
      ports.migration.putCanonicalRunAndState({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        expectedPredecessorRunHash: null,
        run: second,
        state: secondState,
      })
    ).rejects.toThrow('MIGRATION_CHAIN_CONFLICT');
    await expect(
      ports.migration.putCanonicalRunAndState({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        expectedPredecessorRunHash: first.runHash,
        run: second,
        state: secondState,
      })
    ).resolves.toMatchObject({ disposition: 'created', run: second });
    await expect(
      ports.migration.markStaged({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        replayHash: second.runHash,
        safeCounts: { canonicalRuns: 2 },
        finalState: secondState,
      })
    ).resolves.toEqual({ disposition: 'staged' });

    const candidate = await ports.migration.inspectCandidate({
      migrationId: 'mdm_release_001',
      definitionId: 'md_definition',
    });
    expect(candidate).toMatchObject({
      definition: { status: 'migrating', hasRuns: true },
      state: secondState,
      activation: {
        status: 'staging',
        step: 'staged',
        replayHash: second.runHash,
        safeCounts: { canonicalRuns: 2 },
      },
    });
    expect(candidate?.runs.map((run: Record<string, unknown>) => run.runId)).toEqual([
      'mdr_first',
      'mdr_second',
    ]);
  });

  it('atomically admits and compensates a verified candidate with projection parity', async () => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    const { secondState, secondRun } = await seedStagedCandidate(ports);

    await expect(
      ports.visibility.readPublic({ userId: 'owner-001', definitionId: 'md_definition' })
    ).resolves.toEqual({ definitions: [], runs: [] });
    await expect(
      ports.visibility.readFishing({
        userId: 'owner-001',
        legacyGroupKey: 'fishing-group',
      })
    ).resolves.toEqual({ definitions: [], runs: [] });

    const activationInput = {
      migrationId: 'mdm_release_001',
      definitionId: 'md_definition',
      replayHash: secondRun.runHash,
      verificationHash: 'f'.repeat(64),
      replayEndExclusive: secondState.checkpointAt,
      cutoverDeadline: '2026-07-28T13:30:00.000Z',
      nextRunAt: '2026-07-29T01:00:00.000Z',
      readiness: {
        observationVersion: 'readiness-v2',
        observedAt: '2026-07-28T12:00:00.000Z',
      },
      activatedAt: '2026-07-28T12:01:00.000Z',
    };
    await expect(ports.migration.activateAtomically(activationInput)).resolves.toEqual({
      disposition: 'activated',
    });
    await expect(ports.migration.activateAtomically(activationInput)).resolves.toEqual({
      disposition: 'existing',
    });

    const publicProjection = await ports.visibility.readPublic({
      userId: 'owner-001',
      definitionId: 'md_definition',
    });
    const fishingProjection = await ports.visibility.readFishing({
      userId: 'owner-001',
      legacyGroupKey: 'fishing-group',
    });
    expect(publicProjection).toMatchObject({
      definitions: [
        {
          status: 'active',
          activeMigrationId: 'mdm_release_001',
          nextRunAt: activationInput.nextRunAt,
          checkpointAt: secondState.checkpointAt,
          delivery: {
            readinessObservationVersion: 'readiness-v2',
          },
        },
      ],
    });
    expect(publicProjection.runs).toHaveLength(2);
    expect(
      publicProjection.runs.every(
        (run: Record<string, unknown>) => run.visibilityMigrationId === null
      )
    ).toBe(true);
    expect(fishingProjection).toEqual(publicProjection);

    await expect(
      ports.migration.compensateAtomically({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        expectedReplayHash: secondRun.runHash,
        compensatedAt: '2026-07-28T12:05:00.000Z',
      })
    ).resolves.toEqual({ disposition: 'compensated' });
    await expect(
      ports.migration.compensateAtomically({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        expectedReplayHash: secondRun.runHash,
        compensatedAt: '2026-07-28T12:05:00.000Z',
      })
    ).resolves.toEqual({ disposition: 'existing' });
    await expect(
      ports.visibility.readPublic({ userId: 'owner-001', definitionId: 'md_definition' })
    ).resolves.toEqual({ definitions: [], runs: [] });
    const hidden = await ports.migration.inspectCandidate({
      migrationId: 'mdm_release_001',
      definitionId: 'md_definition',
    });
    expect(hidden).toMatchObject({
      definition: { status: 'migrating', activeMigrationId: null },
      activation: { status: 'rollback_pending', step: 'compensated' },
    });
    expect(
      hidden?.runs.every(
        (run: Record<string, unknown>) => run.visibilityMigrationId === 'mdm_release_001'
      )
    ).toBe(true);
  });

  it('atomically restages a compensated hidden chain for the same migration identity', async () => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    const { secondRun, secondState } = await seedCompensatedCandidate(ports);

    await expect(
      ports.migration.restageCompensatedCandidate(restageInput(secondRun.runHash))
    ).resolves.toEqual({ disposition: 'restaged' });
    const restaged = await ports.migration.inspectCandidate({
      migrationId: 'mdm_release_001',
      definitionId: 'md_definition',
    });
    expect(restaged).toMatchObject({
      definition: { status: 'migrating', activeMigrationId: null },
      state: { precedingRunHash: secondRun.runHash, pendingWindow: null },
      activation: {
        status: 'staging',
        step: 'restaged',
        replayHash: null,
        verificationHash: null,
      },
    });
    expect(
      restaged?.runs.every(
        (run: Record<string, unknown>) => run.visibilityMigrationId === 'mdm_release_001'
      )
    ).toBe(true);

    await expect(
      ports.migration.markStaged({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        replayHash: secondRun.runHash,
        safeCounts: { canonicalRuns: 2 },
        finalState: secondState,
      })
    ).resolves.toEqual({ disposition: 'staged' });
  });

  it.each([
    {
      label: 'changed baseline',
      mutate: (store: FakeFirestore): void => {
        mutateStored(store, 'message_digest_migration_activations', 'mdm_release_001', (data) => {
          data['baselineHash'] = 'd'.repeat(64);
        });
      },
    },
    {
      label: 'changed source identity',
      mutate: (store: FakeFirestore): void => {
        mutateStored(store, 'message_digest_definitions', 'md_definition', (data) => {
          (data['source'] as Record<string, unknown>)['generationId'] = 'generation-changed';
        });
      },
    },
    {
      label: 'visible run',
      mutate: (store: FakeFirestore): void => {
        mutateStored(store, 'message_digest_runs', 'mdr_first', (data) => {
          data['visibilityMigrationId'] = null;
        });
      },
    },
    {
      label: 'pending window',
      mutate: (store: FakeFirestore): void => {
        mutateStored(store, 'message_digest_states', 'md_definition', (data) => {
          data['pendingWindow'] = { runId: 'mdr_pending' };
        });
      },
    },
    {
      label: 'outbox record',
      mutate: (store: FakeFirestore): void => {
        store.seedCollection('message_digest_dispatch_outbox', [
          {
            id: 'mdo_race',
            data: { userId: 'owner-001', definitionId: 'md_definition', runId: 'mdr_second' },
          },
        ]);
      },
    },
    {
      label: 'changed owner',
      mutate: (store: FakeFirestore): void => {
        mutateStored(store, 'message_digest_definitions', 'md_definition', (data) => {
          data['userId'] = 'foreign-owner';
        });
      },
    },
    {
      label: 'non-compensated activation',
      mutate: (store: FakeFirestore): void => {
        mutateStored(store, 'message_digest_migration_activations', 'mdm_release_001', (data) => {
          data['status'] = 'staging';
          data['step'] = 'staged';
        });
      },
    },
  ])('rejects restaging a candidate with $label', async ({ mutate }) => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    const { secondRun } = await seedCompensatedCandidate(ports);
    mutate(fake);

    await expect(
      ports.migration.restageCompensatedCandidate(restageInput(secondRun.runHash))
    ).rejects.toThrow('MIGRATION_RESTAGE_CONFLICT');
  });

  it('rejects restaging when the owner API preflight observed a delivery receipt', async () => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    const { secondRun } = await seedCompensatedCandidate(ports);

    await expect(
      ports.migration.restageCompensatedCandidate({
        ...restageInput(secondRun.runHash),
        deliveryReceipts: 1,
      })
    ).rejects.toThrow('MIGRATION_RESTAGE_CONFLICT');
  });

  it('rejects restaging with the wrong replay fence', async () => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    await seedCompensatedCandidate(ports);

    await expect(
      ports.migration.restageCompensatedCandidate(restageInput('f'.repeat(64)))
    ).rejects.toThrow('MIGRATION_RESTAGE_CONFLICT');
  });

  it('rechecks outbox and run safety inside activation and compensation transactions', async () => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    const { secondState, secondRun } = await seedStagedCandidate(ports);
    fake.seedCollection('message_digest_dispatch_outbox', [
      {
        id: 'mdo_race',
        data: { userId: 'owner-001', definitionId: 'md_definition', runId: secondRun.runId },
      },
    ]);

    await expect(
      ports.migration.activateAtomically({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
        replayHash: secondRun.runHash,
        verificationHash: 'f'.repeat(64),
        replayEndExclusive: secondState.checkpointAt,
        cutoverDeadline: '2026-07-28T13:30:00.000Z',
        nextRunAt: '2026-07-29T01:00:00.000Z',
        readiness: {
          observationVersion: 'readiness-v2',
          observedAt: '2026-07-28T12:00:00.000Z',
        },
        activatedAt: '2026-07-28T12:01:00.000Z',
      })
    ).rejects.toThrow('MIGRATION_ACTIVATION_CONFLICT');
    expect(fake.getAllData().get('message_digest_definitions')?.get('md_definition')).toMatchObject(
      { status: 'migrating' }
    );
  });

  it('fails closed when a canonical run is stored under a non-deterministic document id', async () => {
    const ports = createFishingMigrationFirestorePorts({
      firestore: fake as unknown as Firestore,
    });
    await seedStagedCandidate(ports);
    const runs = fake.getAllData().get('message_digest_runs');
    const second = runs?.get('mdr_second');
    expect(second).toBeDefined();
    runs?.delete('mdr_second');
    runs?.set('wrong-document-id', second ?? {});

    await expect(
      ports.migration.inspectCandidate({
        migrationId: 'mdm_release_001',
        definitionId: 'md_definition',
      })
    ).rejects.toThrow('MIGRATION_DOCUMENT_INVALID');
  });
});

function validatedSource(): Record<string, unknown> {
  return {
    sourceAccountId: 'account-001',
    generationId: 'generation-001',
    chatId: 'chat-001',
    chatType: 'group',
    displayName: 'Fishing Group',
    messageCount: 42,
    participantCount: 7,
    lastActivityAt: '2026-07-28T11:00:00.000Z',
    sourceRevision: 'private-revision',
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const SOURCE_REF = '1'.repeat(64);
const SOURCE_REF_2 = '2'.repeat(64);

function aggregateInput(): ReplayAggregateInput {
  return {
    migrationId: 'mdm_release_001',
    definitionId: 'md_definition',
    userId: 'owner-001',
    date: '2026-07-27',
    chatType: 'group' as const,
    conversationLabel: 'Fishing Group',
    windowStart: '2026-07-26T22:00:00.000Z',
    windowEnd: '2026-07-27T22:00:00.000Z',
    instructions: 'Write a concrete Polish digest using only facts from this synthetic window.',
    continuityMemoryMarkdown: 'Previous continuity.',
    previousSummaries: [],
    messages: [
      {
        messageRef: SOURCE_REF,
        eventTimestamp: '2026-07-27T10:00:00.000Z',
        direction: 'inbound' as const,
        authorLabel: 'Synthetic participant',
        text: 'Spotkanie odbędzie się jutro.',
        contentKind: 'text' as const,
      },
    ],
  };
}

function openRouterResponse(aggregate: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'generation-001',
    model: 'anthropic/synthetic-model',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(aggregate) } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 25,
      total_tokens: 125,
      cost: 0.0042,
    },
  };
}

function legacyData(extra: Record<string, unknown>): Record<string, unknown> {
  return { userId: 'owner-001', groupKey: 'fishing-group', ...extra };
}

function migrationRun(runId: string): { id: string; data: Record<string, unknown> } {
  return {
    id: runId,
    data: {
      runId,
      userId: 'owner-001',
      definitionId: 'md_definition',
      visibilityMigrationId: 'mdm_release_001',
      delivery: { status: 'not_sent', idempotencyKey: `message-digest:${runId}` },
    },
  };
}

function migrationShell(): MigrationShell {
  return {
    definition: {
      version: 1,
      definitionId: 'md_definition',
      userId: 'owner-001',
      status: 'migrating',
      listStatus: 'paused',
      revision: 1,
      hasRuns: false,
      activeMigrationId: null,
      legacyAlias: { groupKey: 'fishing-group' },
      source: {
        type: 'private_whatsapp',
        sourceAccountId: 'account-001',
        generationId: 'generation-001',
        chatId: 'chat-001',
        chatType: 'group',
        displayName: 'Fishing Group',
        messageCount: 42,
        lastActivityAt: '2026-07-27T11:00:00.000Z',
        sourceRevision: 'private-revision-initial',
      },
      checkpointAt: '2026-07-01T00:00:00.000Z',
      nextRunAt: '2026-07-01T00:00:00.000Z',
      lastRunAt: null,
      latestRun: null,
      delivery: {
        type: 'whatsapp_primary',
        readinessObservationVersion: 'readiness-v1',
        readinessObservedAt: '2026-07-27T12:00:00.000Z',
      },
      updatedAt: '2026-07-27T12:00:00.000Z',
    },
    state: migrationState(),
    activation: {
      version: 1,
      migrationId: 'mdm_release_001',
      userId: 'owner-001',
      definitionId: 'md_definition',
      legacyGroupKey: 'fishing-group',
      status: 'staging',
      step: 'shell_created',
      baselineHash: 'c'.repeat(64),
      replayHash: null,
      verificationHash: null,
      safeCounts: { auditedLegacyDocuments: 139 },
      cutoverDeadline: '2026-07-28T00:00:00.000Z',
      createdAt: '2026-07-27T12:00:00.000Z',
      updatedAt: '2026-07-27T12:00:00.000Z',
    },
  };
}

function migrationState(overrides: Record<string, unknown> = {}): MigrationState {
  return {
    version: 1,
    definitionId: 'md_definition',
    userId: 'owner-001',
    revision: 1,
    checkpointAt: '2026-07-01T00:00:00.000Z',
    continuityMemoryMarkdown: '',
    precedingRunId: null,
    precedingRunHash: null,
    pendingWindow: null,
    updatedAt: '2026-07-27T12:00:00.000Z',
    ...overrides,
  };
}

function canonicalRun(
  runId: string,
  date: string,
  predecessorRunHash: string | null,
  runHash: string
): CanonicalRun {
  return {
    version: 1,
    runId,
    userId: 'owner-001',
    definitionId: 'md_definition',
    migrationDate: date,
    recordRole: 'canonical',
    visibilityMigrationId: 'mdm_release_001',
    predecessorRunHash,
    runHash,
    candidateHash: runHash,
    deliveryMode: 'silent',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    deliveryAuthorization: null,
    windowStart: `${date}T00:00:00.000Z`,
    windowEnd: `${date}T23:00:00.000Z`,
    headline: `Headline ${date}`,
    completedAt: `${date}T23:00:00.000Z`,
    updatedAt: `${date}T23:00:00.000Z`,
    delivery: {
      status: 'not_sent',
      idempotencyKey: `message-digest:${runId}`,
    },
  };
}

async function seedStagedCandidate(
  ports: ReturnType<typeof createFishingMigrationFirestorePorts>
): Promise<{
  firstRun: CanonicalRun;
  secondRun: CanonicalRun;
  secondState: MigrationState;
}> {
  const shell = migrationShell();
  await ports.migration.createShell(shell);
  const firstRun = canonicalRun('mdr_first', '2026-07-01', null, 'a'.repeat(64));
  const firstState = migrationState({
    revision: 2,
    checkpointAt: firstRun.windowEnd,
    precedingRunId: firstRun.runId,
    precedingRunHash: firstRun.runHash,
    updatedAt: firstRun.completedAt,
  });
  await ports.migration.putCanonicalRunAndState({
    migrationId: 'mdm_release_001',
    definitionId: 'md_definition',
    expectedPredecessorRunHash: null,
    run: firstRun,
    state: firstState,
  });
  const secondRun = canonicalRun('mdr_second', '2026-07-02', firstRun.runHash, 'b'.repeat(64));
  const secondState = migrationState({
    revision: 3,
    checkpointAt: secondRun.windowEnd,
    precedingRunId: secondRun.runId,
    precedingRunHash: secondRun.runHash,
    updatedAt: secondRun.completedAt,
  });
  await ports.migration.putCanonicalRunAndState({
    migrationId: 'mdm_release_001',
    definitionId: 'md_definition',
    expectedPredecessorRunHash: firstRun.runHash,
    run: secondRun,
    state: secondState,
  });
  await ports.migration.markStaged({
    migrationId: 'mdm_release_001',
    definitionId: 'md_definition',
    replayHash: secondRun.runHash,
    safeCounts: { canonicalRuns: 2 },
    finalState: secondState,
  });
  return { firstRun, secondRun, secondState };
}

async function seedCompensatedCandidate(
  ports: ReturnType<typeof createFishingMigrationFirestorePorts>
): Promise<{
  secondRun: CanonicalRun;
  secondState: MigrationState;
}> {
  const { secondRun, secondState } = await seedStagedCandidate(ports);
  await ports.migration.activateAtomically({
    migrationId: 'mdm_release_001',
    definitionId: 'md_definition',
    replayHash: secondRun.runHash,
    verificationHash: 'f'.repeat(64),
    replayEndExclusive: secondState.checkpointAt,
    cutoverDeadline: '2026-07-28T13:30:00.000Z',
    nextRunAt: '2026-07-29T01:00:00.000Z',
    readiness: {
      observationVersion: 'readiness-v2',
      observedAt: '2026-07-28T12:00:00.000Z',
    },
    activatedAt: '2026-07-28T12:01:00.000Z',
  });
  await ports.migration.compensateAtomically({
    migrationId: 'mdm_release_001',
    definitionId: 'md_definition',
    expectedReplayHash: secondRun.runHash,
    compensatedAt: '2026-07-28T12:05:00.000Z',
  });
  return { secondRun, secondState };
}

function restageInput(expectedReplayHash: string): Record<string, unknown> {
  return {
    migrationId: 'mdm_release_001',
    definitionId: 'md_definition',
    shell: migrationShell(),
    expectedReplayHash,
    deliveryReceipts: 0,
    restagedAt: '2026-07-28T12:10:00.000Z',
  };
}

function mutateStored(
  store: FakeFirestore,
  collection: string,
  documentId: string,
  mutate: (data: Record<string, unknown>) => void
): void {
  const data = store.getAllData().get(collection)?.get(documentId);
  if (data === undefined) throw new Error(`Missing synthetic ${collection}/${documentId}`);
  mutate(data);
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing synthetic fixture value');
  return value;
}
