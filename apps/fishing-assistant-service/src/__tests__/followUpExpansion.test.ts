import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@intexuraos/infra-firestore';
import { expandFollowUpEvidence } from '../domain/retrieval/followUpExpansion.js';
import type { FishingChatMessage } from '../domain/models/chat.js';
import type { KnowledgePage } from '../domain/models/knowledge.js';

function makeAssistantMessage(
  citations: FishingChatMessage['citations']
): FishingChatMessage {
  return {
    id: 'assistant-1',
    chatId: 'chat-1',
    userId: 'user-1',
    role: 'assistant',
    content: 'Assistant answer',
    citations,
    confidence: 'high',
    createdAt: Timestamp.now(),
  };
}

function makePage(): KnowledgePage {
  return {
    id: 'page-1',
    userId: 'user-1',
    folderId: 'folder-1',
    title: 'Full Recipe',
    rawText: 'Full recipe body',
    normalizedText: 'Full recipe body',
    contentType: 'recipe',
    indexingStatus: 'ready',
    chunkCount: 1,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

describe('expandFollowUpEvidence', () => {
  it('expands prior cited knowledge pages for full recipe follow-ups', async () => {
    const pageRepository = {
      getByIdForUser: vi.fn().mockResolvedValue({ ok: true, value: makePage() }),
    };

    const result = await expandFollowUpEvidence(
      { pageRepository },
      {
        userId: 'user-1',
        latestUserMessage: 'show me the full recipe',
        recentMessages: [
          makeAssistantMessage([
            {
              sourceId: 'chunk-1',
              sourceType: 'knowledge_page',
              title: 'Full Recipe',
              quote: 'Use light bait',
              usedFor: 'recipe summary',
              pageId: 'page-1',
              url: '/fishing-assistant/knowledge/pages/page-1',
            },
          ]),
        ],
      }
    );

    expect(pageRepository.getByIdForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      pageId: 'page-1',
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'S_FULL_1',
      sourceType: 'knowledge_page',
      title: 'Full Recipe',
      text: 'Full recipe body',
    });
  });

  it('ignores digest and raw-message citations during full-page expansion', async () => {
    const pageRepository = {
      getByIdForUser: vi.fn(),
    };

    const result = await expandFollowUpEvidence(
      { pageRepository },
      {
        userId: 'user-1',
        latestUserMessage: 'show me the full recipe',
        recentMessages: [
          makeAssistantMessage([
            {
              sourceId: 'digest-1',
              sourceType: 'digest',
              title: 'Digest',
              quote: 'digest quote',
              usedFor: 'digest',
            },
            {
              sourceId: 'msg-1',
              sourceType: 'raw_message',
              title: 'Raw message',
              quote: 'message quote',
              usedFor: 'raw',
            },
          ]),
        ],
      }
    );

    expect(pageRepository.getByIdForUser).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('skips missing or unreadable pages during follow-up expansion', async () => {
    const pageRepository = {
      getByIdForUser: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'FIRESTORE_ERROR', message: 'broken' } })
        .mockResolvedValueOnce({ ok: true, value: null }),
    };

    const result = await expandFollowUpEvidence(
      { pageRepository },
      {
        userId: 'user-1',
        latestUserMessage: 'show me the whole page',
        recentMessages: [
          makeAssistantMessage([
            {
              sourceId: 'chunk-1',
              sourceType: 'knowledge_page',
              title: 'Full Recipe',
              quote: 'Use light bait',
              usedFor: 'recipe summary',
              pageId: 'page-1',
            },
            {
              sourceId: 'chunk-2',
              sourceType: 'knowledge_page',
              title: 'Second Recipe',
              quote: 'Use dark bait',
              usedFor: 'recipe summary',
              pageId: 'page-2',
            },
          ]),
        ],
      }
    );

    expect(result).toEqual([]);
  });
});
