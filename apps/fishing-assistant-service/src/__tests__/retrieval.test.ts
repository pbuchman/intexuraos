import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@intexuraos/infra-firestore';
import { retrieveEvidence } from '../domain/retrieval/retrieveEvidence.js';
import type { KnowledgeChunkMatch } from '../domain/models/knowledge.js';
import type { KnowledgeChunkRepository } from '../domain/ports/knowledgeRepositories.js';

function makeChunk(overrides: Partial<KnowledgeChunkMatch> = {}): KnowledgeChunkMatch {
  return {
    id: 'chunk-1',
    userId: 'user-1',
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

describe('retrieveEvidence', () => {
  it('queries knowledge chunks by userId and drops foreign-user results', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({
      ok: true,
      value: [
        makeChunk(),
        makeChunk({ id: 'chunk-foreign', userId: 'other-user', pageId: 'page-x' }),
      ],
    });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      queryDigests: vi.fn(),
      queryGroupMessages: vi.fn(),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'spring bait recipe',
      }
    );

    expect(embeddingClient.embedTexts).toHaveBeenCalledWith({
      userId: 'user-1',
      texts: ['spring bait recipe'],
    });
    expect(chunkRepository.findNearestByUserId).toHaveBeenCalledWith({
      userId: 'user-1',
      embedding: [0.1, 0.2, 0.3],
      limit: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.id)).toEqual(['chunk-1']);
    expect(result.value[0]?.sourceType).toBe('knowledge_page');
  });

  it('uses explicit date ranges for digest lookup and degrades to kb-only on digest failure', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [makeChunk()] });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'API_ERROR', message: 'HTTP 503', status: 503 },
      }),
      queryGroupMessages: vi.fn(),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'compare notes from 2026-05-01 to 2026-05-03 for spring feeder bait',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '2026-05-01',
        dateTo: '2026-05-03',
        terms: ['compare', 'notes', 'spring', 'feeder', 'bait'],
        limit: 8,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((item) => item.sourceType === 'knowledge_page')).toBe(true);
  });

  it('queries raw messages for top digest dates and includes them in the final evidence set', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [] });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              groupKey: 'feeder',
              date: '2026-05-02',
              title: 'May 2',
              summaryMarkdown: 'Discussed feeder bait and pinka.',
              messageCount: 14,
            },
          ],
          truncated: false,
        },
      }),
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [
            {
              messageRef: 'msg-1',
              groupKey: 'feeder',
              date: '2026-05-02',
              postTimeSec: 123,
              senderLabel: 'Piotr',
              text: 'Use pinka with light mix',
              quote: 'Use pinka with light mix',
            },
          ],
          totalRaw: 1,
          totalCleaned: 1,
          returned: 1,
          truncated: false,
        },
      }),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'what did they say about pinka',
      }
    );

    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        date: '2026-05-02',
        terms: ['what', 'they', 'say', 'about', 'pinka'],
        limit: 12,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.sourceType)).toContain('raw_message');
  });

  it('uses a single explicit date for both bounds and skips raw lookups without valid digest metadata', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: false, error: { code: 'DOWNSTREAM_ERROR', message: 'embed failed' } }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [] });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              groupKey: 'feeder',
              date: '2026-05-02',
              title: 'May 2',
              summaryMarkdown: 'Discussed feeder bait and pinka.',
              messageCount: 14,
            },
          ],
          truncated: false,
        },
      }),
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'API_ERROR', message: 'HTTP 503', status: 503 },
      }),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'what happened on 2026-05-02',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '2026-05-02',
        dateTo: '2026-05-02',
        terms: ['what', 'happened'],
        limit: 8,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        date: '2026-05-02',
        terms: ['what', 'happened'],
        limit: 12,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((item) => item.sourceType === 'digest')).toBe(true);
  });

  it('uses the rolling 90-day range when the question has no explicit dates', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [makeChunk()] });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [], truncated: false },
      }),
      queryGroupMessages: vi.fn(),
    };

    await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'where should I fish now',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '2026-02-04',
        dateTo: '2026-05-05',
        terms: ['where', 'should', 'fish', 'now'],
        limit: 8,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.listDigestSubscriptions).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { timeoutMs: 5000 }
    );
  });

  it('caps digest group fan-out while preserving bounded downstream timeouts', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: false, error: { code: 'DOWNSTREAM_ERROR', message: 'embed failed' } }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [] });
    const groups = Array.from({ length: 10 }, (_, index) => ({
      groupKey: `group-${String(index + 1)}`,
      displayName: `Group ${String(index + 1)}`,
    }));
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: groups },
      }),
      queryDigests: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [], truncated: false },
      }),
      queryGroupMessages: vi.fn(),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'recent feeder reports',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledTimes(8);
    expect(mobileNotificationsClient.queryDigests).toHaveBeenLastCalledWith(
      {
        userId: 'user-1',
        groupKey: 'group-8',
        dateFrom: '2026-02-04',
        dateTo: '2026-05-05',
        terms: ['recent', 'feeder', 'reports'],
        limit: 8,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(false);
  });

  it('falls back to an empty embedding vector and digest-only evidence when chunk search fails', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    };
    const chunkRepository = makeChunkRepository({
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'vector search failed' },
    });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              groupKey: undefined,
              date: undefined,
              title: 'Malformed digest',
              summaryMarkdown: 'Still useful text',
              messageCount: 1,
            } as unknown as {
              groupKey: string;
              date: string;
              title: string;
              summaryMarkdown: string;
              messageCount: number;
            },
          ],
          truncated: false,
        },
      }),
      queryGroupMessages: vi.fn(),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'what changed today',
      }
    );

    expect(chunkRepository.findNearestByUserId).toHaveBeenCalledWith({
      userId: 'user-1',
      embedding: [],
      limit: 20,
    });
    expect(mobileNotificationsClient.queryGroupMessages).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.sourceType)).toContain('digest');
  });

  it('degrades to knowledge-base evidence when digest subscriptions cannot be loaded', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [makeChunk()] });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'API_ERROR', message: 'HTTP 503', status: 503 },
      }),
      queryDigests: vi.fn(),
      queryGroupMessages: vi.fn(),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'spring bait recipe',
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.id)).toEqual(['chunk-1']);
    expect(mobileNotificationsClient.queryDigests).not.toHaveBeenCalled();
  });

  it('returns NO_EVIDENCE when no source returns usable evidence', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [] });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      queryDigests: vi.fn(),
      queryGroupMessages: vi.fn(),
    };

    const result = await retrieveEvidence(
      {
        embeddingClient,
        chunkRepository,
        mobileNotificationsClient,
        now: new Date('2026-05-05T12:00:00Z'),
      },
      {
        userId: 'user-1',
        question: 'something with no evidence',
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NO_EVIDENCE',
        message: 'No Fishing Assistant evidence matched the request.',
      },
    });
  });
});
