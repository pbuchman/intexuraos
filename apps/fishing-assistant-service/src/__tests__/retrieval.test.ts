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
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [],
          totalRaw: 0,
          totalCleaned: 0,
          returned: 0,
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
        limit: 100,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((item) => item.sourceType === 'knowledge_page')).toBe(true);
  });

  it('queries raw messages across the full historical range and includes them in the final evidence set', async () => {
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
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['what', 'they', 'say', 'about', 'pinka'],
        limit: 500,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.sourceType)).toContain('raw_message');
  });

  it('uses a single explicit date for digest and raw-message bounds', async () => {
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
        limit: 100,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '2026-05-02',
        dateTo: '2026-05-02',
        terms: ['what', 'happened'],
        limit: 500,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((item) => item.sourceType === 'digest')).toBe(true);
  });

  it('uses the full historical range when the question has no explicit dates', async () => {
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
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [],
          totalRaw: 0,
          totalCleaned: 0,
          returned: 0,
          truncated: false,
        },
      }),
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
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['where', 'should', 'fish', 'now'],
        limit: 100,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['where', 'should', 'fish', 'now'],
        limit: 500,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.listDigestSubscriptions).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { timeoutMs: 5000 }
    );
  });

  it('queries every digest subscription while preserving bounded downstream timeouts', async () => {
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
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [],
          totalRaw: 0,
          totalCleaned: 0,
          returned: 0,
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
        question: 'recent feeder reports',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledTimes(10);
    expect(mobileNotificationsClient.queryDigests).toHaveBeenLastCalledWith(
      {
        userId: 'user-1',
        groupKey: 'group-10',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['recent', 'feeder', 'reports'],
        limit: 100,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledTimes(10);
    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenLastCalledWith(
      {
        userId: 'user-1',
        groupKey: 'group-10',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['recent', 'feeder', 'reports'],
        limit: 500,
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(false);
  });

  it('paginates digest evidence until nextCursor is absent', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [] });
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [
              {
                groupKey: 'feeder',
                date: '2026-05-01',
                title: 'Page 1',
                summaryMarkdown: 'feeder bait first page',
                messageCount: 4,
              },
            ],
            truncated: true,
            nextCursor: 'digest-cursor-2',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [
              {
                groupKey: 'feeder',
                date: '2026-04-30',
                title: 'Page 2',
                summaryMarkdown: 'feeder bait second page',
                messageCount: 3,
              },
            ],
            truncated: false,
          },
        }),
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [],
          totalRaw: 0,
          totalCleaned: 0,
          returned: 0,
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
        question: 'feeder bait',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenNthCalledWith(
      1,
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['feeder', 'bait'],
        limit: 100,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.queryDigests).toHaveBeenNthCalledWith(
      2,
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['feeder', 'bait'],
        limit: 100,
        cursor: 'digest-cursor-2',
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.id)).toEqual([
      'digest:feeder:2026-05-01',
      'digest:feeder:2026-04-30',
    ]);
  });

  it('stops digest pagination when the downstream cursor repeats', async () => {
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
              date: '2026-05-01',
              title: 'Looped page',
              summaryMarkdown: 'feeder bait repeated cursor',
              messageCount: 4,
            },
          ],
          truncated: true,
          nextCursor: 'same-cursor',
        },
      }),
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [],
          totalRaw: 0,
          totalCleaned: 0,
          returned: 0,
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
        question: 'feeder bait',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('stops digest pagination at the per-group page cap', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [] });
    let pageNumber = 0;
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn().mockImplementation(() => {
        pageNumber += 1;
        return Promise.resolve({
          ok: true,
          value: {
            items: [
              {
                groupKey: 'feeder',
                date: '2026-05-01',
                title: `Page ${String(pageNumber)}`,
                summaryMarkdown: `feeder bait digest page ${String(pageNumber)}`,
                messageCount: 1,
              },
            ],
            truncated: true,
            nextCursor: `digest-cursor-${String(pageNumber)}`,
          },
        });
      }),
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [],
          totalRaw: 0,
          totalCleaned: 0,
          returned: 0,
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
        question: 'feeder bait',
      }
    );

    expect(mobileNotificationsClient.queryDigests).toHaveBeenCalledTimes(100);
    expect(result.ok).toBe(true);
  });

  it('paginates raw group-message evidence across the full historical range', async () => {
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
        value: { items: [], truncated: false },
      }),
      queryGroupMessages: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            messages: [
              {
                messageRef: 'msg-1',
                groupKey: 'feeder',
                date: '2026-05-01',
                postTimeSec: 123,
                senderLabel: 'Piotr',
                text: 'feeder bait first raw page',
                quote: 'feeder bait first raw page',
              },
            ],
            totalRaw: 2,
            totalCleaned: 2,
            returned: 1,
            truncated: true,
            nextCursor: 'raw-cursor-2',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            messages: [
              {
                messageRef: 'msg-2',
                groupKey: 'feeder',
                date: '2026-04-30',
                postTimeSec: 122,
                senderLabel: 'Adam',
                text: 'feeder bait second raw page',
                quote: 'feeder bait second raw page',
              },
            ],
            totalRaw: 2,
            totalCleaned: 2,
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
        question: 'feeder bait',
      }
    );

    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenNthCalledWith(
      1,
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['feeder', 'bait'],
        limit: 500,
      },
      { timeoutMs: 5000 }
    );
    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenNthCalledWith(
      2,
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['feeder', 'bait'],
        limit: 500,
        cursor: 'raw-cursor-2',
      },
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.id)).toEqual(['msg-1', 'msg-2']);
  });

  it('stops raw-message pagination when the downstream cursor repeats', async () => {
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
        value: { items: [], truncated: false },
      }),
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [
            {
              messageRef: 'msg-loop',
              groupKey: 'feeder',
              date: '2026-05-01',
              postTimeSec: 123,
              senderLabel: 'Piotr',
              text: 'feeder bait repeated raw cursor',
              quote: 'feeder bait repeated raw cursor',
            },
          ],
          totalRaw: 1,
          totalCleaned: 1,
          returned: 1,
          truncated: true,
          nextCursor: 'same-raw-cursor',
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
        question: 'feeder bait',
      }
    );

    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('stops raw-message pagination at the per-group page cap', async () => {
    const embeddingClient = {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    };
    const chunkRepository = makeChunkRepository({ ok: true, value: [] });
    let pageNumber = 0;
    const mobileNotificationsClient = {
      listDigestSubscriptions: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ groupKey: 'feeder', displayName: 'Feeder' }] },
      }),
      queryDigests: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [], truncated: false },
      }),
      queryGroupMessages: vi.fn().mockImplementation(() => {
        pageNumber += 1;
        return Promise.resolve({
          ok: true,
          value: {
            messages: [
              {
                messageRef: `msg-page-${String(pageNumber)}`,
                groupKey: 'feeder',
                date: '2026-05-01',
                postTimeSec: pageNumber,
                senderLabel: 'Piotr',
                text: `feeder bait raw page ${String(pageNumber)}`,
                quote: `feeder bait raw page ${String(pageNumber)}`,
              },
            ],
            totalRaw: 1,
            totalCleaned: 1,
            returned: 1,
            truncated: true,
            nextCursor: `raw-cursor-${String(pageNumber)}`,
          },
        });
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
        question: 'feeder bait',
      }
    );

    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledTimes(100);
    expect(result.ok).toBe(true);
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
      queryGroupMessages: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messages: [],
          totalRaw: 0,
          totalCleaned: 0,
          returned: 0,
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
        question: 'what changed today',
      }
    );

    expect(chunkRepository.findNearestByUserId).toHaveBeenCalledWith({
      userId: 'user-1',
      embedding: [],
      limit: 20,
    });
    expect(mobileNotificationsClient.queryGroupMessages).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        groupKey: 'feeder',
        dateFrom: '1970-01-01',
        dateTo: '2026-05-05',
        terms: ['what', 'changed', 'today'],
        limit: 500,
      },
      { timeoutMs: 5000 }
    );
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
