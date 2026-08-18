import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Logger } from '@intexuraos/common-core';
import type { AuthUser } from '@intexuraos/common-http';
import { createFakeFirestore, type Firestore, Timestamp } from '@intexuraos/infra-firestore';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';
import { createFirestoreFolderRepository } from '../infra/firestore/folderRepository.js';
import { createFirestorePageRepository } from '../infra/firestore/pageRepository.js';
import { createFirestoreChatRepository } from '../infra/firestore/chatRepository.js';
import type { KnowledgeChunkMatch } from '../domain/models/knowledge.js';

const authState = vi.hoisted(
  (): {
    user: AuthUser | null;
    logIncomingRequest: ReturnType<typeof vi.fn>;
  } => ({
    user: { userId: 'user-1', claims: { email: 'user@example.com' } },
    logIncomingRequest: vi.fn(),
  })
);

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const original = await importOriginal<typeof import('@intexuraos/common-http')>();
  return {
    ...original,
    requireAuth: vi.fn(
      async (_request: unknown, reply: { fail: (code: string, message: string) => void }) => {
        if (authState.user === null) {
          reply.fail('UNAUTHORIZED', 'Missing auth');
          return null;
        }
        return authState.user;
      }
    ),
    logIncomingRequest: authState.logIncomingRequest,
  };
});

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

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

interface RouteTestContext {
  app: FastifyInstance;
  messageDigestClient: {
    queryLegacyDigestDefinitions: ReturnType<typeof vi.fn>;
    queryLegacyDigestRuns: ReturnType<typeof vi.fn>;
  };
  whatsappClient: { queryPrivateDigestMessages: ReturnType<typeof vi.fn> };
  chatAdapter: {
    createClientForUser: ReturnType<typeof vi.fn>;
    modelId: string;
  };
}

function createServices(): Omit<RouteTestContext, 'app'> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  const messageDigestClient = {
    queryLegacyDigestDefinitions: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
    queryLegacyDigestRuns: vi.fn(),
  };
  const whatsappClient = {
    queryPrivateDigestMessages: vi.fn(),
  };
  const llmClient = {
    generate: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"answerMarkdown":"Use light bait in spring water.","citations":[{"sourceId":"chunk-1","usedFor":"spring bait guidance"}],"confidence":"high"}',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
      },
    }),
  };
  const chatAdapter = {
    modelId: 'or:google/gemini-3.6-flash',
    createClientForUser: vi.fn().mockResolvedValue({ ok: true, value: llmClient }),
  };
  const chatRepository = createFirestoreChatRepository({ firestore, logger });
  const chunkRepository = {
    replaceForPage: vi.fn(),
    findByPageId: vi.fn(),
    deleteByPageId: vi.fn(),
    findNearestByUserId: vi.fn().mockResolvedValue({
      ok: true,
      value: [makeChunk()],
    }),
  };

  setServices({
    generateId: vi
      .fn()
      .mockReturnValueOnce('chat-1')
      .mockReturnValueOnce('message-1')
      .mockReturnValueOnce('message-2')
      .mockReturnValue('id-extra'),
    logger,
    repositories: {
      firestore,
      folderRepository: createFirestoreFolderRepository({ firestore, logger }),
      pageRepository: createFirestorePageRepository({ firestore, logger }),
      chunkRepository: chunkRepository as ServiceContainer['repositories']['chunkRepository'],
    },
    chatRepository,
    embeddingClient: {
      embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
    },
    userServiceClient: {} as ServiceContainer['userServiceClient'],
    messageDigestClient: messageDigestClient as unknown as ServiceContainer['messageDigestClient'],
    whatsappClient: whatsappClient as unknown as ServiceContainer['whatsappClient'],
    usageSink: {} as ServiceContainer['usageSink'],
    chatAdapter: chatAdapter as ServiceContainer['chatAdapter'],
  });

  return {
    messageDigestClient,
    whatsappClient,
    chatAdapter,
  };
}

function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isNaN(Date.parse(value as string))).toBe(false);
}

describe('Fishing Assistant chat routes', () => {
  let ctx: RouteTestContext;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    authState.user = { userId: 'user-1', claims: { email: 'user@example.com' } };
    authState.logIncomingRequest.mockClear();
    const services = createServices();
    const app = await buildServer();
    await app.ready();
    ctx = { app, ...services };
  });

  afterEach(async () => {
    resetServices();
    await ctx.app.close();
  });

  it('creates a chat and lists it for the authenticated user', async () => {
    const createResponse = await ctx.app.inject({
      method: 'POST',
      url: '/chats',
    });
    const listResponse = await ctx.app.inject({
      method: 'GET',
      url: '/chats',
    });

    expect(createResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.json().data.chat.id).toBe('chat-1');
    expect(listResponse.json().data.items.map((chat: { id: string }) => chat.id)).toEqual(['chat-1']);

    const createdChat = createResponse.json().data.chat as {
      lastMessageAt: unknown;
      createdAt: unknown;
      updatedAt: unknown;
    };
    const listedChat = listResponse.json().data.items[0] as {
      lastMessageAt: unknown;
      createdAt: unknown;
      updatedAt: unknown;
    };
    for (const value of [
      createdChat.lastMessageAt,
      createdChat.createdAt,
      createdChat.updatedAt,
      listedChat.lastMessageAt,
      listedChat.createdAt,
      listedChat.updatedAt,
    ]) {
      expectIsoTimestamp(value);
    }
  });

  it('sends a message, stores assistant output, and derives the title from the first user message', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/chats',
    });

    const sendResponse = await ctx.app.inject({
      method: 'POST',
      url: '/chats/chat-1/messages',
      payload: { message: 'Give me a spring feeder recipe for cold water' },
    });
    const messagesResponse = await ctx.app.inject({
      method: 'GET',
      url: '/chats/chat-1/messages',
    });
    const chatResponse = await ctx.app.inject({
      method: 'GET',
      url: '/chats/chat-1',
    });

    expect(sendResponse.statusCode).toBe(200);
    expect(messagesResponse.statusCode).toBe(200);
    expect(chatResponse.statusCode).toBe(200);
    expect(messagesResponse.json().data.items.map((item: { role: string }) => item.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(chatResponse.json().data.chat.title).toBe('Give me a spring feeder recipe for cold water');
    expect(sendResponse.json().data.message.citations[0]).toMatchObject({
      sourceId: 'chunk-1',
      sourceType: 'knowledge_page',
    });

    const sentChat = sendResponse.json().data.chat as {
      lastMessageAt: unknown;
      createdAt: unknown;
      updatedAt: unknown;
    };
    const sentMessage = sendResponse.json().data.message as { createdAt: unknown };
    const listedMessages = messagesResponse.json().data.items as { createdAt: unknown }[];
    const fetchedChat = chatResponse.json().data.chat as {
      lastMessageAt: unknown;
      createdAt: unknown;
      updatedAt: unknown;
    };
    for (const value of [
      sentChat.lastMessageAt,
      sentChat.createdAt,
      sentChat.updatedAt,
      sentMessage.createdAt,
      ...listedMessages.map((message) => message.createdAt),
      fetchedChat.lastMessageAt,
      fetchedChat.createdAt,
      fetchedChat.updatedAt,
    ]) {
      expectIsoTimestamp(value);
    }
  });

  it('returns a typed NO_API_KEY error when the user has no OpenRouter key', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/chats',
    });
    ctx.chatAdapter.createClientForUser.mockResolvedValue({
      ok: false,
      error: {
        code: 'NO_API_KEY',
        message: 'OpenRouter API key is required for Fishing Assistant chat.',
      },
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/chats/chat-1/messages',
      payload: { message: 'Need a recipe' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NO_API_KEY');
  });

  it('returns NOT_FOUND for missing chats and validates message bodies', async () => {
    const missingChat = await ctx.app.inject({
      method: 'GET',
      url: '/chats/missing',
    });
    const missingMessages = await ctx.app.inject({
      method: 'GET',
      url: '/chats/missing/messages',
    });
    const invalidBody = await ctx.app.inject({
      method: 'POST',
      url: '/chats/missing/messages',
      payload: { message: '   ' },
    });
    const invalidMessageType = await ctx.app.inject({
      method: 'POST',
      url: '/chats/missing/messages',
      payload: { message: 42 },
    });

    expect(missingChat.statusCode).toBe(404);
    expect(missingMessages.statusCode).toBe(404);
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidMessageType.statusCode).toBe(400);
  });

  it('maps repository errors for list/create/get routes and rejects non-object message bodies', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    setServices({
      generateId: vi.fn().mockReturnValue('chat-error'),
      logger,
      repositories: {
        firestore,
        folderRepository: createFirestoreFolderRepository({ firestore, logger }),
        pageRepository: createFirestorePageRepository({ firestore, logger }),
        chunkRepository: {
          replaceForPage: vi.fn(),
          findByPageId: vi.fn(),
          deleteByPageId: vi.fn(),
          findNearestByUserId: vi.fn(),
        },
      },
      chatRepository: {
        createChat: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'create failed' },
        }),
        listChatsByUserId: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'list failed' },
        }),
        getChatByIdForUser: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'get failed' },
        }),
        updateChat: vi.fn(),
        createMessage: vi.fn(),
        listMessagesForChat: vi.fn().mockResolvedValue({
          ok: true,
          value: [],
        }),
      } as ServiceContainer['chatRepository'],
      embeddingClient: {
        embedTexts: vi.fn(),
      } as ServiceContainer['embeddingClient'],
      userServiceClient: {} as ServiceContainer['userServiceClient'],
      messageDigestClient: {} as ServiceContainer['messageDigestClient'],
      whatsappClient: {} as ServiceContainer['whatsappClient'],
      usageSink: {} as ServiceContainer['usageSink'],
      chatAdapter: {
        modelId: 'or:google/gemini-3.6-flash',
        createClientForUser: vi.fn(),
      } as ServiceContainer['chatAdapter'],
    });

    const listResponse = await ctx.app.inject({
      method: 'GET',
      url: '/chats',
    });
    const createResponse = await ctx.app.inject({
      method: 'POST',
      url: '/chats',
    });
    const getResponse = await ctx.app.inject({
      method: 'GET',
      url: '/chats/chat-1',
    });
    const invalidBody = await ctx.app.inject({
      method: 'POST',
      url: '/chats/chat-1/messages',
      payload: 'null',
      headers: { 'content-type': 'application/json' },
    });

    expect(listResponse.statusCode).toBe(500);
    expect(createResponse.statusCode).toBe(500);
    expect(getResponse.statusCode).toBe(500);
    expect(invalidBody.statusCode).toBe(400);
  });

  it('falls back to an insufficient-evidence assistant answer when retrieval returns nothing', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const chatRepository = createFirestoreChatRepository({ firestore, logger });
    setServices({
      ...(({
        generateId: vi
          .fn()
          .mockReturnValueOnce('chat-2')
          .mockReturnValueOnce('message-3')
          .mockReturnValueOnce('message-4'),
        logger,
        repositories: {
          firestore,
          folderRepository: createFirestoreFolderRepository({ firestore, logger }),
          pageRepository: createFirestorePageRepository({ firestore, logger }),
          chunkRepository: {
            replaceForPage: vi.fn(),
            findByPageId: vi.fn(),
            deleteByPageId: vi.fn(),
            findNearestByUserId: vi.fn().mockResolvedValue({ ok: true, value: [] }),
          },
        },
        chatRepository,
        embeddingClient: {
          embedTexts: vi.fn().mockResolvedValue({ ok: true, value: [[0.1, 0.2, 0.3]] }),
        },
        userServiceClient: {} as ServiceContainer['userServiceClient'],
        messageDigestClient: {
          queryLegacyDigestDefinitions: vi
            .fn()
            .mockResolvedValue({ ok: true, value: { items: [] } }),
        } as unknown as ServiceContainer['messageDigestClient'],
        whatsappClient: {} as ServiceContainer['whatsappClient'],
        usageSink: {} as ServiceContainer['usageSink'],
        chatAdapter: {
          modelId: 'or:google/gemini-3.6-flash',
          createClientForUser: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              generate: vi.fn(),
            },
          }),
        } as ServiceContainer['chatAdapter'],
      }) satisfies ServiceContainer),
    });

    await ctx.app.inject({
      method: 'POST',
      url: '/chats',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/chats/chat-2/messages',
      payload: { message: 'What about today?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.message.content).toContain('not have enough evidence');
    expect(response.json().data.message.citations).toEqual([]);
  });

  it('repairs invalid model output before storing the assistant answer', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/chats',
    });
    ctx.chatAdapter.createClientForUser.mockResolvedValueOnce({
      ok: true,
      value: {
        generate: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            value: {
              content: 'not-json',
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
            },
          })
          .mockResolvedValueOnce({
            ok: true,
            value: {
              content:
                '{"answerMarkdown":"Use light bait in spring water.","citations":[{"sourceId":"chunk-1","usedFor":"spring bait guidance"}],"confidence":"high"}',
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.01 },
            },
          }),
      },
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/chats/chat-1/messages',
      payload: { message: 'Need a repairable answer' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.message.content).toContain('Use light bait');
  });
});
