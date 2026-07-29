import { describe, expect, it, vi } from 'vitest';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { Timestamp } from '@intexuraos/infra-firestore';
import type {
  LegacyDigestDefinitionProjection,
  LegacyDigestRunProjection,
  PrivateDigestMessage,
} from '@intexuraos/internal-clients';
import type { KnowledgeChunkMatch, KnowledgePage } from '../domain/models/knowledge.js';
import type { FishingChat, FishingChatMessage } from '../domain/models/chat.js';
import type { KnowledgeEmbeddingClient } from '../domain/ports/embeddingClient.js';
import type { FishingChatRepository } from '../domain/ports/chatRepository.js';
import type { FixedModelChatAdapter } from '../domain/ports/chatModel.js';
import type { KnowledgeChunkRepository, KnowledgePageRepository } from '../domain/ports/knowledgeRepositories.js';
import { fishingAnswerPrompt } from '../domain/prompts/buildFishingAnswerPrompt.js';
import { FISHING_LEGACY_GROUP_KEY } from '../domain/retrieval/fishingDigestSource.js';
import type { SendChatMessageDeps } from '../domain/usecases/sendChatMessage.js';
import { sendChatMessage } from '../domain/usecases/sendChatMessage.js';

function okResult<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function errResult<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

function makeChat(overrides: Partial<FishingChat> = {}): FishingChat {
  const now = Timestamp.now();
  return {
    id: 'chat-1',
    userId: 'user-1',
    title: 'New Chat',
    lastMessagePreview: '',
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<FishingChatMessage> = {}): FishingChatMessage {
  return {
    id: 'message-1',
    chatId: 'chat-1',
    userId: 'user-1',
    role: 'assistant',
    content: 'Answer',
    citations: [],
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

function makeChunk(overrides: Partial<KnowledgeChunkMatch> = {}): KnowledgeChunkMatch {
  return {
    id: 'chunk-1',
    userId: 'user-1',
    pageId: 'page-1',
    folderId: 'folder-1',
    title: 'Spring Bait',
    heading: 'Recipe',
    index: 0,
    text: 'Use pinka in spring water.',
    searchableText: 'spring bait pinka',
    contentType: 'recipe',
    embeddingModel: 'text-embedding-3-small',
    createdAt: Timestamp.now(),
    vectorScore: 0.91,
    ...overrides,
  };
}

function makeDigestDefinition(): LegacyDigestDefinitionProjection {
  return {
    definitionId: 'md_fishing_001',
    legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
    source: {
      sourceAccountId: 'account-fishing-001',
      generationId: 'generation-fishing-001',
      chatId: 'chat-fishing-001',
      chatType: 'group',
    },
    activeMigrationId: 'mdm_fishing_001',
  };
}

function makeDigestRun(
  overrides: Partial<LegacyDigestRunProjection> = {}
): LegacyDigestRunProjection {
  return {
    definitionId: 'md_fishing_001',
    runId: 'mdr_fishing_001',
    legacyGroupKey: FISHING_LEGACY_GROUP_KEY,
    date: '2026-05-07',
    title: 'May 7 digest',
    summaryMarkdown: 'Members recommended krill extract for the hemp-coconut base.',
    messageCount: 18,
    evidenceMessageRefs: [],
    windowStart: '2026-05-06T00:00:00.000Z',
    windowEnd: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

function makePrivateMessage(overrides: Partial<PrivateDigestMessage> = {}): PrivateDigestMessage {
  return {
    messageRef: 'msg-1',
    eventTimestamp: '2026-05-01T10:00:00.000Z',
    direction: 'inbound',
    authorLabel: 'Piotr',
    text: 'Use pinka with a light mix.',
    contentKind: 'text',
    ...overrides,
  };
}

interface SendChatMessageTestContext {
  deps: SendChatMessageDeps;
  chatRepository: {
    createChat: ReturnType<typeof vi.fn>;
    listChatsByUserId: ReturnType<typeof vi.fn>;
    getChatByIdForUser: ReturnType<typeof vi.fn>;
    updateChat: ReturnType<typeof vi.fn>;
    createMessage: ReturnType<typeof vi.fn>;
    listMessagesForChat: ReturnType<typeof vi.fn>;
  };
  chatAdapter: {
    modelId: string;
    createClientForUser: ReturnType<typeof vi.fn>;
  };
  llmClient: {
    generate: ReturnType<typeof vi.fn>;
  };
  embeddingClient: {
    embedTexts: ReturnType<typeof vi.fn>;
  };
  chunkRepository: {
    replaceForPage: ReturnType<typeof vi.fn>;
    findByPageId: ReturnType<typeof vi.fn>;
    deleteByPageId: ReturnType<typeof vi.fn>;
    findNearestByUserId: ReturnType<typeof vi.fn>;
  };
  pageRepository: {
    getByIdForUser: ReturnType<typeof vi.fn>;
  };
  messageDigestClient: {
    queryLegacyDigestDefinitions: ReturnType<typeof vi.fn>;
    queryLegacyDigestRuns: ReturnType<typeof vi.fn>;
  };
  whatsappClient: { queryPrivateDigestMessages: ReturnType<typeof vi.fn> };
}

function createContext(input?: {
  chat?: FishingChat;
  updatedChat?: FishingChat;
  recentMessages?: FishingChatMessage[];
}): SendChatMessageTestContext {
  const chat = input?.chat ?? makeChat();
  const updatedChat = input?.updatedChat ?? makeChat({ title: chat.title });
  const userMessage = makeMessage({
    id: 'message-user',
    role: 'user',
    content: 'Question',
  });
  const assistantMessage = makeMessage({
    id: 'message-assistant',
    content: 'Use pinka in spring water.',
    citations: [
      {
        sourceId: 'chunk-1',
        sourceType: 'knowledge_page',
        title: 'Spring Bait',
        quote: 'Use pinka in spring water.',
        usedFor: 'bait guidance',
        url: '/fishing-assistant/knowledge/pages/page-1',
        pageId: 'page-1',
      },
    ],
    confidence: 'high',
  });

  const chatRepository = {
    createChat: vi.fn(),
    listChatsByUserId: vi.fn(),
    getChatByIdForUser: vi
      .fn()
      .mockResolvedValueOnce(okResult(chat))
      .mockResolvedValueOnce(okResult(updatedChat)),
    updateChat: vi.fn().mockResolvedValue(okResult(updatedChat)),
    createMessage: vi
      .fn()
      .mockResolvedValueOnce(okResult(userMessage))
      .mockResolvedValueOnce(okResult(assistantMessage)),
    listMessagesForChat: vi.fn().mockResolvedValue(okResult(input?.recentMessages ?? [])),
  };
  const llmClient = {
    generate: vi.fn().mockResolvedValue(
      okResult({
        content:
          '{"answerMarkdown":"Use pinka in spring water.","citations":[{"sourceId":"chunk-1","usedFor":"bait guidance"}],"confidence":"high"}',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
      })
    ),
  };
  const chatAdapter = {
    modelId: 'or:google/gemini-3-flash-preview',
    createClientForUser: vi.fn().mockResolvedValue(okResult(llmClient as unknown as LlmGenerateClient)),
  };
  const embeddingClient = {
    embedTexts: vi.fn().mockResolvedValue(okResult([[0.1, 0.2, 0.3]])),
  };
  const chunkRepository = {
    replaceForPage: vi.fn(),
    findByPageId: vi.fn(),
    deleteByPageId: vi.fn(),
    findNearestByUserId: vi.fn().mockResolvedValue(okResult([makeChunk()])),
  };
  const pageRepository = {
    getByIdForUser: vi.fn().mockResolvedValue(okResult(null)),
  };
  const messageDigestClient = {
    queryLegacyDigestDefinitions: vi.fn().mockResolvedValue(okResult({ items: [] })),
    queryLegacyDigestRuns: vi.fn(),
  };
  const whatsappClient = {
    queryPrivateDigestMessages: vi.fn().mockResolvedValue(
      okResult({
        messages: [],
        sourceRevision: 'source-revision-001',
        highWatermark: null,
        nextCursor: null,
      })
    ),
  };

  return {
    deps: {
      chatRepository: chatRepository as unknown as FishingChatRepository,
      chatAdapter: chatAdapter as unknown as FixedModelChatAdapter,
      embeddingClient: embeddingClient as unknown as KnowledgeEmbeddingClient,
      chunkRepository: chunkRepository as unknown as KnowledgeChunkRepository,
      pageRepository: pageRepository as unknown as KnowledgePageRepository,
      messageDigestClient,
      whatsappClient,
      generateId: vi
        .fn()
        .mockReturnValueOnce('message-user')
        .mockReturnValueOnce('message-assistant')
        .mockReturnValue('message-extra'),
      now: new Date('2026-05-05T12:00:00Z'),
    },
    chatRepository,
    chatAdapter,
    llmClient,
    embeddingClient,
    chunkRepository,
    pageRepository,
    messageDigestClient,
    whatsappClient,
  };
}

function makePage(overrides: Partial<KnowledgePage> = {}): KnowledgePage {
  return {
    id: 'page-1',
    userId: 'user-1',
    folderId: 'folder-1',
    title: 'Spring Bait',
    rawText: 'Full recipe text',
    normalizedText: 'full recipe text',
    contentType: 'recipe',
    indexingStatus: 'ready',
    chunkCount: 1,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

describe('sendChatMessage', () => {
  it('returns repository lookup errors before doing any work', async () => {
    const ctx = createContext();
    ctx.chatRepository.getChatByIdForUser.mockReset().mockResolvedValueOnce(
      errResult({ code: 'FIRESTORE_ERROR', message: 'db down' })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result).toEqual(errResult({ code: 'FIRESTORE_ERROR', message: 'db down' }));
    expect(ctx.chatRepository.createMessage).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the chat does not exist', async () => {
    const ctx = createContext();
    ctx.chatRepository.getChatByIdForUser.mockReset().mockResolvedValueOnce(okResult(null));

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'missing',
      message: 'Need a recipe',
    });

    expect(result).toEqual(
      errResult({ code: 'NOT_FOUND', message: 'Fishing chat missing not found' })
    );
  });

  it('returns repository errors when the user message cannot be stored', async () => {
    const ctx = createContext();
    ctx.chatRepository.createMessage.mockReset().mockResolvedValueOnce(
      errResult({ code: 'FIRESTORE_ERROR', message: 'write failed' })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result).toEqual(errResult({ code: 'FIRESTORE_ERROR', message: 'write failed' }));
  });

  it('derives a New Chat title from blank input and returns title update failures', async () => {
    const ctx = createContext();
    ctx.chatRepository.updateChat.mockResolvedValueOnce(
      errResult({ code: 'FIRESTORE_ERROR', message: 'title failed' })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: '   ',
    });

    expect(ctx.chatRepository.updateChat).toHaveBeenCalledWith({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'New Chat',
    });
    expect(result).toEqual(errResult({ code: 'FIRESTORE_ERROR', message: 'title failed' }));
  });

  it('does not rename chats that already have a custom title and maps raw-message citations', async () => {
    const ctx = createContext({
      chat: makeChat({ title: 'Spring Session' }),
      updatedChat: makeChat({ title: 'Spring Session' }),
    });
    ctx.chatRepository.createMessage.mockReset()
      .mockResolvedValueOnce(
        okResult(makeMessage({ id: 'message-user', role: 'user', content: 'What did the group say?' }))
      )
      .mockResolvedValueOnce(
        okResult(
          makeMessage({
            id: 'message-assistant',
            citations: [
              {
                sourceId: 'msg-1',
                sourceType: 'raw_message',
                title: 'Piotr',
                quote: 'Use pinka with a light mix.',
                usedFor: 'raw group guidance',
                date: '2026-05-01',
              },
            ],
            confidence: 'high',
          })
        )
      );
    ctx.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValue(
      okResult({ items: [makeDigestDefinition()] })
    );
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue(
      okResult({
        items: [
          makeDigestRun({
            date: '2026-05-01',
            title: 'May 1 digest',
            summaryMarkdown: 'Members reported pinka.',
            messageCount: 12,
            evidenceMessageRefs: ['msg-1'],
            windowStart: '2026-04-30T00:00:00.000Z',
            windowEnd: '2026-05-02T00:00:00.000Z',
          }),
        ],
        truncated: false,
        nextCursor: null,
      })
    );
    ctx.whatsappClient.queryPrivateDigestMessages.mockResolvedValue(
      okResult({
        messages: [makePrivateMessage()],
        sourceRevision: 'source-revision-001',
        highWatermark: 'watermark-001',
        nextCursor: null,
      })
    );
    ctx.llmClient.generate.mockResolvedValue(
      okResult({
        content:
          '{"answerMarkdown":"Use pinka with a light mix.","citations":[{"sourceId":"msg-1","usedFor":"raw group guidance"}],"confidence":"high"}',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
      })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'What did the group say about pinka?',
    });

    expect(ctx.chatRepository.updateChat).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String) })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ctx.chatRepository.createMessage).toHaveBeenNthCalledWith(2, {
      id: 'message-assistant',
      chatId: 'chat-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'Use pinka with a light mix.',
      confidence: 'high',
      citations: [
        {
          sourceId: 'msg-1',
          sourceType: 'raw_message',
          title: 'Piotr',
          quote: 'Use pinka with a light mix.',
          usedFor: 'raw group guidance',
          date: '2026-05-01',
        },
      ],
    });
    expect(result.value.message.citations).toEqual([
      {
        sourceId: 'msg-1',
        sourceType: 'raw_message',
        title: 'Piotr',
        quote: 'Use pinka with a light mix.',
        usedFor: 'raw group guidance',
        date: '2026-05-01',
      },
    ]);
  });

  it('passes every repository-returned current-chat message to the answer prompt', async () => {
    const recentMessages = [
      makeMessage({ id: 'history-1', role: 'user', content: 'First question' }),
      makeMessage({ id: 'history-2', role: 'assistant', content: 'First answer' }),
      makeMessage({ id: 'history-3', role: 'user', content: 'Follow-up detail' }),
      makeMessage({ id: 'history-4', role: 'assistant', content: 'Follow-up answer' }),
      makeMessage({ id: 'history-5', role: 'user', content: 'Latest stored user question' }),
    ];
    const ctx = createContext({ recentMessages });
    const buildSpy = vi.spyOn(fishingAnswerPrompt, 'build');

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result.ok).toBe(true);
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Need a recipe',
        recentMessages,
      })
    );
    expect(buildSpy.mock.calls[0]?.[0].recentMessages.map((message) => message.id)).toEqual([
      'history-1',
      'history-2',
      'history-3',
      'history-4',
      'history-5',
    ]);
    buildSpy.mockRestore();
  });

  it('maps prompt citation aliases back to canonical digest source ids without invoking repair', async () => {
    const ctx = createContext({
      chat: makeChat({ title: 'Spring Session' }),
      updatedChat: makeChat({ title: 'Spring Session' }),
    });
    ctx.chatRepository.createMessage.mockReset()
      .mockResolvedValueOnce(
        okResult(makeMessage({ id: 'message-user', role: 'user', content: 'Need the coconut recipe' }))
      )
      .mockResolvedValueOnce(
        okResult(
          makeMessage({
            id: 'message-assistant',
            citations: [
              {
                sourceId: `digest:${FISHING_LEGACY_GROUP_KEY}:2026-05-07`,
                sourceType: 'digest',
                title: 'May 7 digest',
                quote: 'Members recommended krill extract for the hemp-coconut base.',
                usedFor: 'method-feeder modification',
                date: '2026-05-07',
                url: `/fishing-assistant/digests/${FISHING_LEGACY_GROUP_KEY}/2026-05-07`,
              },
            ],
            confidence: 'high',
          })
        )
      );
    ctx.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValue(
      okResult({ items: [makeDigestDefinition()] })
    );
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue(
      okResult({
        items: [makeDigestRun()],
        truncated: false,
        nextCursor: null,
      })
    );
    ctx.llmClient.generate.mockReset()
      .mockResolvedValueOnce(
        okResult({
          content:
            '{"answerMarkdown":"Add krill extract to the hemp-coconut base.","citations":[{"sourceId":"S1","usedFor":"method-feeder modification"}],"confidence":"high"}',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      )
      .mockResolvedValueOnce(errResult({ code: 'DOWNSTREAM_ERROR', message: 'repair should not run' }));

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'How should I adapt the coconut recipe for method feeder?',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ctx.llmClient.generate).toHaveBeenCalledTimes(1);
    expect(ctx.chatRepository.createMessage).toHaveBeenNthCalledWith(2, {
      id: 'message-assistant',
      chatId: 'chat-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'Add krill extract to the hemp-coconut base.',
      confidence: 'high',
      citations: [
        {
          sourceId: `digest:${FISHING_LEGACY_GROUP_KEY}:2026-05-07`,
          sourceType: 'digest',
          title: 'May 7 digest',
          quote: 'Members recommended krill extract for the hemp-coconut base.',
          usedFor: 'method-feeder modification',
          date: '2026-05-07',
          url: `/fishing-assistant/digests/${FISHING_LEGACY_GROUP_KEY}/2026-05-07`,
        },
      ],
    });
  });

  it('repairs support-only answers when knowledge-base evidence is available', async () => {
    const ctx = createContext({
      chat: makeChat({ title: 'Spring Session' }),
      updatedChat: makeChat({ title: 'Spring Session' }),
    });
    ctx.chatRepository.createMessage.mockReset()
      .mockResolvedValueOnce(
        okResult(makeMessage({ id: 'message-user', role: 'user', content: 'Need the sweet recipe' }))
      )
      .mockResolvedValueOnce(
        okResult(
          makeMessage({
            id: 'message-assistant',
            content: 'Use the knowledge-base sweet biscuit recipe.',
            citations: [
              {
                sourceId: 'chunk-low-score',
                sourceType: 'knowledge_page',
                title: 'Spring Bait',
                quote: 'The knowledge base recipe uses sweet biscuit crumb.',
                usedFor: 'base recipe',
                url: '/fishing-assistant/knowledge/pages/page-1',
                pageId: 'page-1',
              },
            ],
            confidence: 'high',
          })
        )
      );
    ctx.chunkRepository.findNearestByUserId.mockResolvedValue(
      okResult([
        makeChunk({
          id: 'chunk-low-score',
          text: 'The knowledge base recipe uses sweet biscuit crumb.',
          searchableText: 'archived recipe',
          vectorScore: 0.1,
        }),
      ])
    );
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValue(
      okResult({ items: [makeDigestDefinition()] })
    );
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue(
      okResult({
        items: [
          makeDigestRun({
            summaryMarkdown: 'Members discussed sweet biscuit crumb method feeder bait.',
          }),
        ],
        truncated: false,
        nextCursor: null,
      })
    );
    ctx.llmClient.generate.mockReset()
      .mockResolvedValueOnce(
        okResult({
          content:
            '{"answerMarkdown":"Use the digest method feeder notes.","citations":[{"sourceId":"S2","usedFor":"supporting report"}],"confidence":"high"}',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      )
      .mockResolvedValueOnce(
        okResult({
          content:
            '{"answerMarkdown":"Use the knowledge-base sweet biscuit recipe.","citations":[{"sourceId":"S1","usedFor":"base recipe"}],"confidence":"high"}',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'How should I use sweet biscuit crumb for method feeder bait?',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ctx.llmClient.generate).toHaveBeenCalledTimes(2);
    expect(ctx.llmClient.generate.mock.calls[1]?.[0]).toContain(
      'Fishing Assistant answers must cite at least one knowledge-base source.'
    );
    expect(ctx.chatRepository.createMessage).toHaveBeenNthCalledWith(2, {
      id: 'message-assistant',
      chatId: 'chat-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'Use the knowledge-base sweet biscuit recipe.',
      confidence: 'high',
      citations: [
        {
          sourceId: 'chunk-low-score',
          sourceType: 'knowledge_page',
          title: 'Spring Bait',
          quote: 'The knowledge base recipe uses sweet biscuit crumb.',
          usedFor: 'base recipe',
          url: '/fishing-assistant/knowledge/pages/page-1',
          pageId: 'page-1',
        },
      ],
    });
  });

  it('returns repository errors when recent messages cannot be listed', async () => {
    const ctx = createContext({
      chat: makeChat({ title: 'Spring Session' }),
      updatedChat: makeChat({ title: 'Spring Session' }),
    });
    ctx.chatRepository.listMessagesForChat.mockResolvedValueOnce(
      errResult({ code: 'FIRESTORE_ERROR', message: 'recent failed' })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result).toEqual(errResult({ code: 'FIRESTORE_ERROR', message: 'recent failed' }));
  });

  it('returns DOWNSTREAM_ERROR when the chat client cannot be created for reasons other than missing keys', async () => {
    const ctx = createContext();
    ctx.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([makeChunk()]));
    ctx.chatAdapter.createClientForUser.mockResolvedValueOnce(
      errResult({ code: 'USER_KEYS_UNAVAILABLE', message: 'keys unavailable' })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result).toEqual(
      errResult({ code: 'DOWNSTREAM_ERROR', message: 'keys unavailable' })
    );
  });

  it('returns NO_API_KEY before fallback storage when no evidence is available', async () => {
    const ctx = createContext();
    ctx.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValueOnce(
      okResult({ items: [] })
    );
    ctx.chatAdapter.createClientForUser.mockResolvedValueOnce(
      errResult({ code: 'NO_API_KEY', message: 'missing key' })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result).toEqual(errResult({ code: 'NO_API_KEY', message: 'missing key' }));
    expect(ctx.chatAdapter.createClientForUser).toHaveBeenCalledWith('user-1');
    expect(ctx.chatRepository.createMessage).toHaveBeenCalledTimes(1);
  });

  it('stores the fallback answer without generating when no evidence is available', async () => {
    const ctx = createContext();
    ctx.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValueOnce(
      okResult({ items: [] })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result.ok).toBe(true);
    expect(ctx.chatAdapter.createClientForUser).toHaveBeenCalledWith('user-1');
    expect(ctx.llmClient.generate).not.toHaveBeenCalled();
    expect(ctx.chatRepository.createMessage).toHaveBeenNthCalledWith(2, {
      id: 'message-assistant',
      chatId: 'chat-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'I do not have enough evidence to answer that confidently.',
      citations: [],
      confidence: 'low',
    });
  });

  it('repairs schema-valid but citation-invalid output before storing the answer', async () => {
    const ctx = createContext();
    ctx.llmClient.generate
      .mockResolvedValueOnce(
        okResult({
          content:
            '{"answerMarkdown":"Use pinka.","citations":[],"confidence":"medium"}',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      )
      .mockResolvedValueOnce(
        okResult({
          content:
            '{"answerMarkdown":"Use pinka.","citations":[{"sourceId":"chunk-1","usedFor":"bait guidance"}],"confidence":"medium"}',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ctx.llmClient.generate).toHaveBeenCalledTimes(2);
    expect(ctx.chatRepository.createMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        confidence: 'medium',
        citations: [
          expect.objectContaining({
            sourceId: 'chunk-1',
            usedFor: 'bait guidance',
          }),
        ],
      })
    );
  });

  it('returns citation-validation failures for primary, repair, and revalidation errors', async () => {
    const firstCallFailure = createContext();
    firstCallFailure.llmClient.generate.mockResolvedValueOnce(
      errResult({ code: 'DOWNSTREAM_ERROR', message: 'llm down' })
    );

    const firstCallResult = await sendChatMessage(firstCallFailure.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(firstCallResult).toEqual(
      errResult({ code: 'CITATION_VALIDATION_FAILED', message: 'llm down' })
    );

    const repairFailure = createContext();
    repairFailure.llmClient.generate
      .mockResolvedValueOnce(
        okResult({
          content: 'not-json',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      )
      .mockResolvedValueOnce(errResult({ code: 'DOWNSTREAM_ERROR', message: 'repair failed' }));

    const repairFailureResult = await sendChatMessage(repairFailure.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(repairFailureResult).toEqual(
      errResult({ code: 'CITATION_VALIDATION_FAILED', message: 'repair failed' })
    );

    const reparsedFailure = createContext();
    reparsedFailure.llmClient.generate
      .mockResolvedValueOnce(
        okResult({
          content: 'not-json',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      )
      .mockResolvedValueOnce(
        okResult({
          content: 'still-not-json',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      );

    const reparsedFailureResult = await sendChatMessage(reparsedFailure.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(reparsedFailureResult).toEqual(
      errResult({
        code: 'CITATION_VALIDATION_FAILED',
        message: 'Fishing Assistant response was not valid JSON.',
      })
    );

    const revalidatedFailure = createContext();
    revalidatedFailure.llmClient.generate
      .mockResolvedValueOnce(
        okResult({
          content: 'not-json',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      )
      .mockResolvedValueOnce(
        okResult({
          content:
            '{"answerMarkdown":"Use pinka.","citations":[],"confidence":"medium"}',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
        })
      );

    const revalidatedFailureResult = await sendChatMessage(revalidatedFailure.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(revalidatedFailureResult).toEqual(
      errResult({
        code: 'CITATION_VALIDATION_FAILED',
        message: 'Fishing Assistant answers must cite at least one source.',
      })
    );
  });

  it('returns repository errors when the assistant message or final chat read fails', async () => {
    const assistantWriteFailure = createContext();
    assistantWriteFailure.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    assistantWriteFailure.chatRepository.createMessage.mockReset()
      .mockResolvedValueOnce(okResult(makeMessage({ id: 'message-user', role: 'user' })))
      .mockResolvedValueOnce(errResult({ code: 'FIRESTORE_ERROR', message: 'assistant failed' }));

    const assistantWriteResult = await sendChatMessage(assistantWriteFailure.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(assistantWriteResult).toEqual(
      errResult({ code: 'FIRESTORE_ERROR', message: 'assistant failed' })
    );

    const finalReadFailure = createContext();
    finalReadFailure.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    finalReadFailure.chatRepository.getChatByIdForUser.mockReset()
      .mockResolvedValueOnce(okResult(makeChat()))
      .mockResolvedValueOnce(errResult({ code: 'FIRESTORE_ERROR', message: 'final read failed' }));

    const finalReadResult = await sendChatMessage(finalReadFailure.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(finalReadResult).toEqual(
      errResult({ code: 'FIRESTORE_ERROR', message: 'final read failed' })
    );

    const finalMissing = createContext();
    finalMissing.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    finalMissing.chatRepository.getChatByIdForUser.mockReset()
      .mockResolvedValueOnce(okResult(makeChat()))
      .mockResolvedValueOnce(okResult(null));

    const finalMissingResult = await sendChatMessage(finalMissing.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Need a recipe',
    });

    expect(finalMissingResult).toEqual(
      errResult({ code: 'NOT_FOUND', message: 'Fishing chat chat-1 not found' })
    );
  });

  it('includes full-page follow-up evidence when recent citations reference a knowledge page', async () => {
    const ctx = createContext({
      recentMessages: [
        makeMessage({
          role: 'assistant',
          citations: [
            {
              sourceId: 'chunk-1',
              sourceType: 'knowledge_page',
              title: 'Spring Bait',
              quote: 'Use pinka in spring water.',
              usedFor: 'bait guidance',
              pageId: 'page-1',
              url: '/fishing-assistant/knowledge/pages/page-1',
            },
          ],
        }),
      ],
    });
    ctx.chatRepository.createMessage.mockReset()
      .mockResolvedValueOnce(okResult(makeMessage({ id: 'message-user', role: 'user' })))
      .mockResolvedValueOnce(
        okResult(
          makeMessage({
            id: 'message-assistant',
            citations: [
              {
                sourceId: 'S_FULL_1',
                sourceType: 'knowledge_page',
                title: 'Spring Bait',
                quote: 'Full recipe text',
                usedFor: 'full page context',
                url: '/fishing-assistant/knowledge/pages/page-1',
                pageId: 'page-1',
              },
            ],
            confidence: 'high',
          })
        )
      );
    ctx.chunkRepository.findNearestByUserId.mockResolvedValue(okResult([]));
    ctx.pageRepository.getByIdForUser.mockResolvedValueOnce(okResult(makePage()));
    ctx.llmClient.generate.mockResolvedValueOnce(
      okResult({
        content:
          '{"answerMarkdown":"Read the full recipe.","citations":[{"sourceId":"S_FULL_1","usedFor":"full page context"}],"confidence":"high"}',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
      })
    );

    const result = await sendChatMessage(ctx.deps, {
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Show me the full recipe text',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ctx.chatRepository.createMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        citations: [
          {
            sourceId: 'S_FULL_1',
            sourceType: 'knowledge_page',
            title: 'Spring Bait',
            quote: 'Full recipe text',
            usedFor: 'full page context',
            url: '/fishing-assistant/knowledge/pages/page-1',
            pageId: 'page-1',
          },
        ],
      })
    );
    expect(result.value.message.citations).toEqual([
      {
        sourceId: 'S_FULL_1',
        sourceType: 'knowledge_page',
        title: 'Spring Bait',
        quote: 'Full recipe text',
        usedFor: 'full page context',
        url: '/fishing-assistant/knowledge/pages/page-1',
        pageId: 'page-1',
      },
    ]);
  });
});
