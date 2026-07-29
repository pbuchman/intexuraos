import { Timestamp } from '@intexuraos/infra-firestore';
import type {
  LegacyDigestDefinitionProjection,
  LegacyDigestRunProjection,
  MessageDigestServiceClient,
  PrivateDigestMessage,
  WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeChunkMatch } from '../domain/models/knowledge.js';
import type { KnowledgeChunkRepository } from '../domain/ports/knowledgeRepositories.js';
import {
  FISHING_LEGACY_GROUP_KEY,
} from '../domain/retrieval/fishingDigestSource.js';
import {
  retrieveEvidence,
  type RetrieveEvidenceDeps,
} from '../domain/retrieval/retrieveEvidence.js';

describe('retrieveEvidence', () => {
  it('queries knowledge by owner and drops foreign chunks when no migrated alias exists', async () => {
    const ctx = context({
      chunks: [
        chunk(),
        chunk({ id: 'chunk-foreign', userId: 'synthetic-user-foreign', pageId: 'page-x' }),
      ],
    });

    const result = await retrieveEvidence(ctx.deps, request('spring bait recipe'));

    expect(ctx.embeddingClient.embedTexts).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      texts: ['spring bait recipe'],
    });
    expect(ctx.chunkRepository.findNearestByUserId).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      embedding: [0.1, 0.2, 0.3],
      limit: 20,
    });
    expect(ctx.messageDigestClient.queryLegacyDigestDefinitions).toHaveBeenCalledWith(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
      },
      { timeoutMs: 5_000 }
    );
    expect(result).toMatchObject({ ok: true, value: [{ id: 'chunk-1' }] });
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).not.toHaveBeenCalled();
    expect(ctx.whatsappClient.queryPrivateDigestMessages).not.toHaveBeenCalled();
  });

  it('uses an empty vector for a successful but empty embedding response', async () => {
    const ctx = context({ chunks: [chunk()] });
    ctx.embeddingClient.embedTexts.mockResolvedValueOnce({ ok: true, value: [] });

    await expect(retrieveEvidence(ctx.deps, request('spring bait recipe'))).resolves.toMatchObject({
      ok: true,
    });
    expect(ctx.chunkRepository.findNearestByUserId).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: [] })
    );
  });

  it('queries the exact alias with explicit dates and terms, then ranks its safe summary', async () => {
    const ctx = context({
      definition: definitionProjection(),
      runs: [runProjection()],
    });

    const result = await retrieveEvidence(
      ctx.deps,
      request('compare catch notes from 2026-07-01 to 2026-07-31')
    );

    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledWith(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
        fromDate: '2026-07-01',
        toDate: '2026-07-31',
        terms: expect.arrayContaining(['compare', 'catch', 'notes']),
        limit: 100,
      },
      { timeoutMs: 5_000 }
    );
    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          id: `digest:${FISHING_LEGACY_GROUP_KEY}:2026-07-27`,
          sourceType: 'digest',
          title: 'Fishing plans',
        },
      ],
    });
  });

  it('uses one explicit date for both digest bounds', async () => {
    const ctx = context({ definition: definitionProjection(), runs: [] });

    await retrieveEvidence(ctx.deps, request('what happened on 2026-07-27?'));

    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: '2026-07-27', toDate: '2026-07-27' }),
      { timeoutMs: 5_000 }
    );
  });

  it('uses a bounded 90-day Fishing-local window when no date appears', async () => {
    const ctx = context({ definition: definitionProjection(), runs: [] });

    await retrieveEvidence(ctx.deps, request('latest catch plans'));

    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: '2026-04-30', toDate: '2026-07-28' }),
      { timeoutMs: 5_000 }
    );
  });

  it('omits terms when extraction is empty', async () => {
    const ctx = context({ definition: definitionProjection(), runs: [] });

    await retrieveEvidence(ctx.deps, request('2026-07-27'));

    const body = ctx.messageDigestClient.queryLegacyDigestRuns.mock.calls[0]?.[0];
    expect(body).not.toHaveProperty('terms');
  });

  it('continues digest pagination and stops when a signed cursor repeats', async () => {
    const ctx = context({ definition: definitionProjection() });
    ctx.messageDigestClient.queryLegacyDigestRuns
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [runProjection()],
          truncated: true,
          nextCursor: 'cursor-2',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [runProjection({ runId: 'mdr_run_002', date: '2026-07-26' })],
          truncated: true,
          nextCursor: 'cursor-2',
        },
      });

    const result = await retrieveEvidence(ctx.deps, request('catch plans'));

    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledTimes(2);
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'cursor-2' }),
      { timeoutMs: 5_000 }
    );
    expect(result).toMatchObject({
      ok: true,
      value: [
        { id: `digest:${FISHING_LEGACY_GROUP_KEY}:2026-07-27` },
        { id: `digest:${FISHING_LEGACY_GROUP_KEY}:2026-07-26` },
      ],
    });
  });

  it('drops foreign, mis-aliased, and duplicate digest runs before evidence ranking', async () => {
    const canonical = runProjection();
    const ctx = context({
      definition: definitionProjection(),
      runs: [
        runProjection({ definitionId: 'md_foreign_definition' }),
        runProjection({ runId: 'mdr_wrong_alias', legacyGroupKey: 'other-group' }),
        canonical,
        canonical,
      ],
    });

    const result = await retrieveEvidence(ctx.deps, request('catch plans'));

    expect(result).toMatchObject({
      ok: true,
      value: [{ id: `digest:${FISHING_LEGACY_GROUP_KEY}:2026-07-27` }],
    });
  });

  it('caps digest scanning at two pages and raw expansion at four top runs', async () => {
    const ctx = context({ definition: definitionProjection() });
    const firstPageRuns = Array.from({ length: 4 }, (_, index) =>
      runProjection({
        runId: `mdr_ranked_${String(index + 1)}`,
        date: `2026-07-${String(27 - index).padStart(2, '0')}`,
        title: `Catch plan ${String(index + 1)}`,
        evidenceMessageRefs: [`message-ref-${String(index + 1)}`],
      })
    );
    ctx.messageDigestClient.queryLegacyDigestRuns
      .mockResolvedValueOnce({
        ok: true,
        value: { items: firstPageRuns, truncated: true, nextCursor: 'digest-cursor-2' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [
            runProjection({
              runId: 'mdr_ranked_5',
              date: '2026-07-23',
              evidenceMessageRefs: ['message-ref-5'],
            }),
          ],
          truncated: true,
          nextCursor: 'digest-cursor-3',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [], truncated: false, nextCursor: null },
      });

    await retrieveEvidence(ctx.deps, request('catch plan'));

    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledTimes(2);
    expect(ctx.whatsappClient.queryPrivateDigestMessages).toHaveBeenCalledTimes(4);
  });

  it('caps each raw WhatsApp expansion at two pages even when cursors keep advancing', async () => {
    const ctx = context({
      definition: definitionProjection(),
      runs: [runProjection({ evidenceMessageRefs: ['message-ref-never-returned'] })],
    });
    ctx.whatsappClient.queryPrivateDigestMessages
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [],
          sourceRevision: 'source-revision-001',
          highWatermark: 'watermark-001',
          nextCursor: 'whatsapp-cursor-2',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [],
          sourceRevision: 'source-revision-001',
          highWatermark: 'watermark-002',
          nextCursor: 'whatsapp-cursor-3',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [],
          sourceRevision: 'source-revision-001',
          highWatermark: 'watermark-003',
          nextCursor: null,
        },
      });

    await retrieveEvidence(ctx.deps, request('catch plans'));

    expect(ctx.whatsappClient.queryPrivateDigestMessages).toHaveBeenCalledTimes(2);
  });

  it('reads only exact evidence refs through the returned WhatsApp source fence', async () => {
    const ctx = context({
      definition: definitionProjection(),
      runs: [runProjection({ evidenceMessageRefs: ['message-ref-allowed'] })],
      messages: [
        message({ messageRef: 'message-ref-allowed', eventTimestamp: '2026-07-26T22:30:00.000Z' }),
        message({ messageRef: 'message-ref-unrelated', text: 'Private unrelated message' }),
      ],
    });

    const result = await retrieveEvidence(ctx.deps, request('catch plans'));

    expect(ctx.whatsappClient.queryPrivateDigestMessages).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      windowStart: '2026-07-26T07:00:00.000Z',
      windowEnd: '2026-07-27T07:00:00.000Z',
      limit: 200,
    });
    expect(result).toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          id: 'message-ref-allowed',
          sourceType: 'raw_message',
          date: '2026-07-27',
          title: 'Synthetic angler',
        }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain('Private unrelated message');
  });

  it('continues WhatsApp pagination, deduplicates refs, and stops on a repeated cursor', async () => {
    const ctx = context({
      definition: definitionProjection(),
      runs: [
        runProjection({
          evidenceMessageRefs: ['message-ref-001', 'message-ref-002'],
        }),
      ],
    });
    ctx.whatsappClient.queryPrivateDigestMessages
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [message({ messageRef: 'message-ref-001' })],
          sourceRevision: 'source-revision-001',
          highWatermark: 'watermark-001',
          nextCursor: 'whatsapp-cursor-2',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messages: [
            message({ messageRef: 'message-ref-001' }),
            message({ messageRef: 'message-ref-002' }),
          ],
          sourceRevision: 'source-revision-001',
          highWatermark: 'watermark-002',
          nextCursor: 'whatsapp-cursor-2',
        },
      });

    const result = await retrieveEvidence(ctx.deps, request('catch plans'));

    expect(ctx.whatsappClient.queryPrivateDigestMessages).toHaveBeenCalledTimes(2);
    expect(ctx.whatsappClient.queryPrivateDigestMessages).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'whatsapp-cursor-2' })
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.filter((item) => item.id === 'message-ref-001')).toHaveLength(1);
    expect(result.value.filter((item) => item.id === 'message-ref-002')).toHaveLength(1);
  });

  it('keeps digest evidence but no raw text after a source-generation conflict', async () => {
    const ctx = context({
      definition: definitionProjection(),
      runs: [runProjection({ evidenceMessageRefs: ['message-ref-001'] })],
    });
    ctx.whatsappClient.queryPrivateDigestMessages.mockResolvedValue({
      ok: false,
      error: { code: 'source_changed', httpStatus: 409 },
    });

    const result = await retrieveEvidence(ctx.deps, request('catch plans'));

    expect(result).toMatchObject({
      ok: true,
      value: [{ sourceType: 'digest' }],
    });
  });

  it('makes a foreign alias or direct source absent before digest and WhatsApp queries', async () => {
    for (const invalidDefinition of [
      { ...definitionProjection(), legacyGroupKey: 'some-other-group' },
      {
        ...definitionProjection(),
        source: { ...definitionProjection().source, chatType: 'direct' as const },
      },
    ]) {
      const ctx = context({ definition: invalidDefinition as LegacyDigestDefinitionProjection });
      const result = await retrieveEvidence(ctx.deps, request('catch plans'));

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'NO_EVIDENCE',
          message: 'No Fishing Assistant evidence matched the request.',
        },
      });
      expect(ctx.messageDigestClient.queryLegacyDigestRuns).not.toHaveBeenCalled();
      expect(ctx.whatsappClient.queryPrivateDigestMessages).not.toHaveBeenCalled();
    }
  });

  it('degrades to knowledge evidence on definition or digest service failure', async () => {
    const definitionFailure = context({ chunks: [chunk()] });
    definitionFailure.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValue({
      ok: false,
      error: { code: 'TIMEOUT', message: 'Request exceeded 5000ms' },
    });
    const digestFailure = context({ chunks: [chunk()], definition: definitionProjection() });
    digestFailure.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue({
      ok: false,
      error: { code: 'MALFORMED_ENVELOPE', message: 'Invalid response' },
    });

    const first = await retrieveEvidence(definitionFailure.deps, request('spring bait'));
    const second = await retrieveEvidence(digestFailure.deps, request('spring bait'));

    expect(first).toMatchObject({ ok: true, value: [{ sourceType: 'knowledge_page' }] });
    expect(second).toMatchObject({ ok: true, value: [{ sourceType: 'knowledge_page' }] });
    expect(digestFailure.whatsappClient.queryPrivateDigestMessages).not.toHaveBeenCalled();
  });

  it('degrades to digest evidence when embedding or chunk lookup fails', async () => {
    const embeddingFailure = context({ definition: definitionProjection(), runs: [runProjection()] });
    embeddingFailure.embeddingClient.embedTexts.mockResolvedValue({
      ok: false,
      error: { code: 'DOWNSTREAM_ERROR', message: 'embedding unavailable' },
    });
    const chunkFailure = context({ definition: definitionProjection(), runs: [runProjection()] });
    vi.mocked(chunkFailure.chunkRepository.findNearestByUserId).mockResolvedValue({
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'query failed' },
    });

    const first = await retrieveEvidence(embeddingFailure.deps, request('catch plans'));
    const second = await retrieveEvidence(chunkFailure.deps, request('catch plans'));

    expect(first).toMatchObject({ ok: true, value: [{ sourceType: 'digest' }] });
    expect(second).toMatchObject({ ok: true, value: [{ sourceType: 'digest' }] });
  });

  it('does not query WhatsApp when matched summaries carry no evidence refs', async () => {
    const ctx = context({
      definition: definitionProjection(),
      runs: [runProjection({ evidenceMessageRefs: [] })],
    });

    const result = await retrieveEvidence(ctx.deps, request('catch plans'));

    expect(result).toMatchObject({ ok: true, value: [{ sourceType: 'digest' }] });
    expect(ctx.whatsappClient.queryPrivateDigestMessages).not.toHaveBeenCalled();
  });

  it('prioritizes up to twelve owner knowledge items before bounded support evidence', async () => {
    const chunks = Array.from({ length: 14 }, (_, index) =>
      chunk({
        id: `chunk-${String(index + 1)}`,
        pageId: `page-${String(index + 1)}`,
        vectorScore: 0.99 - index / 100,
      })
    );
    const runs = Array.from({ length: 16 }, (_, index) =>
      runProjection({
        runId: `mdr_run_${String(index + 1).padStart(3, '0')}`,
        date: `2026-07-${String(index + 1).padStart(2, '0')}`,
        evidenceMessageRefs: [],
      })
    );
    const ctx = context({ chunks, definition: definitionProjection(), runs });

    const result = await retrieveEvidence(ctx.deps, request('spring catch plans'));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value).toHaveLength(16);
    expect(result.value.slice(0, 12).every((item) => item.sourceType === 'knowledge_page')).toBe(
      true
    );
    expect(result.value.slice(12).every((item) => item.sourceType === 'digest')).toBe(true);
  });

  it('returns NO_EVIDENCE when every owned source is empty', async () => {
    const ctx = context();

    const result = await retrieveEvidence(ctx.deps, request('unknown topic'));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NO_EVIDENCE',
        message: 'No Fishing Assistant evidence matched the request.',
      },
    });
  });

  it('fails explicitly if Intl omits a Fishing local-date component', async () => {
    const ctx = context({ definition: definitionProjection() });
    const formatToParts = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockReturnValue([
        { type: 'year', value: '2026' },
        { type: 'month', value: '07' },
      ]);

    try {
      await expect(retrieveEvidence(ctx.deps, request('latest catch plans'))).rejects.toThrow(
        'INVALID_FISHING_LOCAL_DATE'
      );
    } finally {
      formatToParts.mockRestore();
    }
  });
});

interface ContextOptions {
  chunks?: KnowledgeChunkMatch[];
  definition?: LegacyDigestDefinitionProjection;
  runs?: LegacyDigestRunProjection[];
  messages?: PrivateDigestMessage[];
}

function context(options: ContextOptions = {}): {
  deps: RetrieveEvidenceDeps;
  embeddingClient: { embedTexts: ReturnType<typeof vi.fn> };
  chunkRepository: KnowledgeChunkRepository;
  messageDigestClient: {
    queryLegacyDigestDefinitions: ReturnType<typeof vi.fn>;
    queryLegacyDigestRuns: ReturnType<typeof vi.fn>;
  };
  whatsappClient: { queryPrivateDigestMessages: ReturnType<typeof vi.fn> };
} {
  const embeddingClient = {
    embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
  };
  const chunkRepository = makeChunkRepository({ ok: true, value: options.chunks ?? [] });
  const messageDigestClient = {
    queryLegacyDigestDefinitions: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: options.definition === undefined ? [] : [options.definition] },
    }),
    queryLegacyDigestRuns: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: options.runs ?? [], truncated: false, nextCursor: null },
    }),
  };
  const whatsappClient = {
    queryPrivateDigestMessages: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        messages: options.messages ?? [],
        sourceRevision: 'source-revision-001',
        highWatermark: null,
        nextCursor: null,
      },
    }),
  };
  return {
    deps: {
      embeddingClient,
      chunkRepository,
      messageDigestClient: messageDigestClient as unknown as Pick<
        MessageDigestServiceClient,
        'queryLegacyDigestDefinitions' | 'queryLegacyDigestRuns'
      >,
      whatsappClient: whatsappClient as unknown as Pick<
        WhatsAppServiceClient,
        'queryPrivateDigestMessages'
      >,
      now: new Date('2026-07-28T12:00:00.000Z'),
    },
    embeddingClient,
    chunkRepository,
    messageDigestClient,
    whatsappClient,
  };
}

function request(question: string): { userId: string; question: string } {
  return { userId: 'synthetic-user-001', question };
}

function makeChunkRepository(
  value: Awaited<ReturnType<KnowledgeChunkRepository['findNearestByUserId']>>
): KnowledgeChunkRepository {
  return {
    replaceForPage: vi.fn(),
    findByPageId: vi.fn(),
    deleteByPageId: vi.fn(),
    findNearestByUserId: vi.fn().mockResolvedValue(value),
  };
}

function chunk(overrides: Partial<KnowledgeChunkMatch> = {}): KnowledgeChunkMatch {
  return {
    id: 'chunk-1',
    userId: 'synthetic-user-001',
    pageId: 'page-1',
    folderId: 'folder-1',
    title: 'Spring Bait',
    heading: 'Recipe',
    index: 0,
    text: 'Use light bait in spring water.',
    searchableText: 'spring bait light water',
    contentType: 'recipe',
    embeddingModel: 'text-embedding-3-small',
    createdAt: Timestamp.now(),
    vectorScore: 0.92,
    ...overrides,
  };
}

function definitionProjection(): LegacyDigestDefinitionProjection {
  return {
    definitionId: 'md_definition_001',
    legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
    source: {
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
    },
    activeMigrationId: 'mdm_migration_001',
  };
}

function runProjection(
  overrides: Partial<LegacyDigestRunProjection> = {}
): LegacyDigestRunProjection {
  return {
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
    date: '2026-07-27',
    title: 'Fishing plans',
    summaryMarkdown: '- The catch was strong.',
    messageCount: 12,
    evidenceMessageRefs: [],
    windowStart: '2026-07-26T07:00:00.000Z',
    windowEnd: '2026-07-27T07:00:00.000Z',
    ...overrides,
  };
}

function message(overrides: Partial<PrivateDigestMessage> = {}): PrivateDigestMessage {
  return {
    messageRef: 'message-ref-001',
    eventTimestamp: '2026-07-27T06:30:00.000Z',
    direction: 'inbound',
    authorLabel: 'Synthetic angler',
    text: 'The catch was strong.',
    contentKind: 'text',
    ...overrides,
  };
}
