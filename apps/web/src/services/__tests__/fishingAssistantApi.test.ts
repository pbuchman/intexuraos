import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFishingChat,
  createFishingKnowledgeFolder,
  createFishingKnowledgePage,
  deleteFishingKnowledgeFolder,
  deleteFishingKnowledgePage,
  getFishingDigestDetail,
  getFishingKnowledgePage,
  listFishingChatMessages,
  listFishingChats,
  listFishingDigestGroups,
  listFishingDigests,
  listFishingKnowledgeFolders,
  listFishingKnowledgePages,
  reindexFishingKnowledgePage,
  sendFishingChatMessage,
  updateFishingKnowledgeFolder,
  updateFishingKnowledgePage,
} from '../fishingAssistantApi.js';
import type {
  FishingChat,
  FishingChatMessage,
  FishingDigestDetail,
  FishingDigestGroup,
  FishingDigestListResponse,
  FishingKnowledgeFolder,
  FishingKnowledgePage,
} from '@/types/fishingAssistant';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('@/config', () => ({
  config: {
    fishingAssistantServiceUrl: 'https://fishing-assistant.test',
  },
}));

describe('fishingAssistantApi', () => {
  const accessToken = 'test-access-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists digest groups from the fishing assistant service', async () => {
    const groups: FishingDigestGroup[] = [{ groupKey: 'feeder', displayName: 'Feeder Team' }];
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ items: groups });

    const result = await listFishingDigestGroups(accessToken);

    expect(apiRequest).toHaveBeenCalledWith(
      'https://fishing-assistant.test',
      '/fishing/digest-groups',
      accessToken
    );
    expect(result).toEqual(groups);
  });

  it('lists digests for a selected group and date range', async () => {
    const response: FishingDigestListResponse = {
      items: [
        {
          groupKey: 'feeder',
          date: '2026-05-01',
          title: 'May 1',
          summaryMarkdown: '- spring bait',
          messageCount: 12,
        },
      ],
      truncated: false,
    };
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue(response);

    const result = await listFishingDigests(accessToken, {
      groupKey: 'feeder',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-03',
    });

    expect(apiRequest).toHaveBeenCalledWith(
      'https://fishing-assistant.test',
      '/fishing/digests?groupKey=feeder&dateFrom=2026-05-01&dateTo=2026-05-03',
      accessToken
    );
    expect(result).toEqual(response);
  });

  it('fetches digest detail with state', async () => {
    const detail: FishingDigestDetail = {
      digest: {
        groupKey: 'feeder',
        date: '2026-05-01',
        title: 'May 1',
        summaryMarkdown: '- spring bait',
        messageCount: 12,
      },
      state: null,
    };
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue(detail);

    const result = await getFishingDigestDetail(accessToken, 'feeder', '2026-05-01');

    expect(apiRequest).toHaveBeenCalledWith(
      'https://fishing-assistant.test',
      '/fishing/digests/feeder/2026-05-01',
      accessToken
    );
    expect(result).toEqual(detail);
  });

  it('lists folders and pages from the knowledge base', async () => {
    const folders: FishingKnowledgeFolder[] = [
      {
        id: 'folder-1',
        userId: 'user-1',
        name: 'Recipes',
        parentId: null,
        sortOrder: 0,
        pageCount: 1,
        createdAt: '2026-05-06T10:00:00.000Z',
        updatedAt: '2026-05-06T11:00:00.000Z',
      },
    ];
    const pages: FishingKnowledgePage[] = [
      {
        id: 'page-1',
        userId: 'user-1',
        folderId: 'folder-1',
        title: 'Spring Bait',
        rawText: 'raw',
        normalizedText: 'normalized',
        contentType: 'recipe',
        indexingStatus: 'ready',
        chunkCount: 1,
        createdAt: '2026-05-06T10:00:00.000Z',
        updatedAt: '2026-05-06T12:00:00.000Z',
      },
    ];
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ items: folders })
      .mockResolvedValueOnce({ items: pages });

    const folderResult = await listFishingKnowledgeFolders(accessToken);
    const pageResult = await listFishingKnowledgePages(accessToken, 'folder-1');

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://fishing-assistant.test',
      '/fishing/folders',
      accessToken
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://fishing-assistant.test',
      '/fishing/pages?folderId=folder-1',
      accessToken
    );
    expect(folderResult).toEqual(folders);
    expect(pageResult).toEqual(pages);
  });

  it('normalizes Firestore timestamp-like dates in knowledge and chat responses', async () => {
    const firestoreJsonTimestamp = (iso: string): { _seconds: number; _nanoseconds: number } => {
      const millis = Date.parse(iso);
      return {
        _seconds: Math.floor(millis / 1000),
        _nanoseconds: (millis % 1000) * 1_000_000,
      };
    };
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        items: [
          {
            id: 'folder-1',
            userId: 'user-1',
            name: 'Recipes',
            parentId: null,
            sortOrder: 0,
            pageCount: 1,
            createdAt: firestoreJsonTimestamp('2026-05-06T10:00:00.000Z'),
            updatedAt: firestoreJsonTimestamp('2026-05-06T11:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'page-1',
            userId: 'user-1',
            folderId: 'folder-1',
            title: 'Spring Bait',
            rawText: 'raw',
            normalizedText: 'normalized',
            contentType: 'recipe',
            indexingStatus: 'ready',
            chunkCount: 1,
            createdAt: firestoreJsonTimestamp('2026-05-06T10:00:00.000Z'),
            updatedAt: firestoreJsonTimestamp('2026-05-06T12:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'chat-1',
            userId: 'user-1',
            title: 'Spring bait',
            lastMessagePreview: 'Use pinka',
            lastMessageAt: firestoreJsonTimestamp('2026-05-06T09:30:00.000Z'),
            createdAt: firestoreJsonTimestamp('2026-05-06T09:00:00.000Z'),
            updatedAt: firestoreJsonTimestamp('2026-05-06T10:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'message-1',
            chatId: 'chat-1',
            userId: 'user-1',
            role: 'assistant',
            content: 'Use pinka',
            citations: [],
            createdAt: firestoreJsonTimestamp('2026-05-06T10:01:00.000Z'),
            confidence: 'high',
          },
        ],
      });

    await expect(listFishingKnowledgeFolders(accessToken)).resolves.toEqual([
      {
        id: 'folder-1',
        userId: 'user-1',
        name: 'Recipes',
        parentId: null,
        sortOrder: 0,
        pageCount: 1,
        createdAt: '2026-05-06T10:00:00.000Z',
        updatedAt: '2026-05-06T11:00:00.000Z',
      },
    ]);
    await expect(listFishingKnowledgePages(accessToken, 'folder-1')).resolves.toEqual([
      {
        id: 'page-1',
        userId: 'user-1',
        folderId: 'folder-1',
        title: 'Spring Bait',
        rawText: 'raw',
        normalizedText: 'normalized',
        contentType: 'recipe',
        indexingStatus: 'ready',
        chunkCount: 1,
        createdAt: '2026-05-06T10:00:00.000Z',
        updatedAt: '2026-05-06T12:00:00.000Z',
      },
    ]);
    await expect(listFishingChats(accessToken)).resolves.toEqual([
      {
        id: 'chat-1',
        userId: 'user-1',
        title: 'Spring bait',
        lastMessagePreview: 'Use pinka',
        lastMessageAt: '2026-05-06T09:30:00.000Z',
        createdAt: '2026-05-06T09:00:00.000Z',
        updatedAt: '2026-05-06T10:00:00.000Z',
      },
    ]);
    await expect(listFishingChatMessages(accessToken, 'chat-1')).resolves.toEqual([
      {
        id: 'message-1',
        chatId: 'chat-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Use pinka',
        citations: [],
        createdAt: '2026-05-06T10:01:00.000Z',
        confidence: 'high',
      },
    ]);
  });

  it('normalizes Date, callable toDate, and seconds/nanoseconds timestamp values', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValueOnce({
      items: [
        {
          id: 'folder-1',
          userId: 'user-1',
          name: 'Recipes',
          parentId: null,
          sortOrder: 0,
          pageCount: 1,
          createdAt: new Date('2026-05-06T10:00:00.000Z'),
          updatedAt: {
            toDate: (): Date => new Date('2026-05-06T11:00:00.000Z'),
          },
        },
        {
          id: 'folder-2',
          userId: 'user-1',
          name: 'Tactics',
          parentId: null,
          sortOrder: 1,
          pageCount: 0,
          createdAt: { seconds: 1778061600, nanoseconds: 123_000_000 },
          updatedAt: { seconds: 1778065200 },
        },
      ],
    });

    await expect(listFishingKnowledgeFolders(accessToken)).resolves.toEqual([
      {
        id: 'folder-1',
        userId: 'user-1',
        name: 'Recipes',
        parentId: null,
        sortOrder: 0,
        pageCount: 1,
        createdAt: '2026-05-06T10:00:00.000Z',
        updatedAt: '2026-05-06T11:00:00.000Z',
      },
      {
        id: 'folder-2',
        userId: 'user-1',
        name: 'Tactics',
        parentId: null,
        sortOrder: 1,
        pageCount: 0,
        createdAt: '2026-05-06T10:00:00.123Z',
        updatedAt: '2026-05-06T11:00:00.000Z',
      },
    ]);
  });

  it('throws a clear error for invalid timestamp fallback values', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const invalidTimestampResponses = [
      { createdAt: { toDate: 'not-callable' }, updatedAt: '2026-05-06T11:00:00.000Z' },
      { createdAt: 'not-a-date', updatedAt: '2026-05-06T11:00:00.000Z' },
    ];

    for (const response of invalidTimestampResponses) {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [
          {
            id: 'folder-1',
            userId: 'user-1',
            name: 'Recipes',
            parentId: null,
            sortOrder: 0,
            pageCount: 1,
            ...response,
          },
        ],
      });

      await expect(listFishingKnowledgeFolders(accessToken)).rejects.toThrow(
        new Error('Invalid Fishing Assistant timestamp value')
      );
    }
  });

  it('creates, updates, deletes, and reindexes knowledge resources', async () => {
    const page: FishingKnowledgePage = {
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Spring Bait',
      rawText: 'raw',
      normalizedText: 'normalized',
      contentType: 'recipe',
      indexingStatus: 'ready',
      chunkCount: 1,
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T12:00:00.000Z',
    };
    const folder: FishingKnowledgeFolder = {
      id: 'folder-1',
      userId: 'user-1',
      name: 'Recipes',
      parentId: null,
      sortOrder: 0,
      pageCount: 1,
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T11:00:00.000Z',
    };
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ folder })
      .mockResolvedValueOnce({ folder: { ...folder, name: 'Updated Recipes' } })
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce({ page })
      .mockResolvedValueOnce({ page })
      .mockResolvedValueOnce({ page: { ...page, rawText: 'updated raw' } })
      .mockResolvedValueOnce({ page: { ...page, indexingStatus: 'pending' } })
      .mockResolvedValueOnce({ deleted: true });

    expect(await createFishingKnowledgeFolder(accessToken, { name: 'Recipes' })).toEqual(folder);
    expect(
      await updateFishingKnowledgeFolder(accessToken, 'folder-1', {
        name: 'Updated Recipes',
        parentId: null,
        sortOrder: 0,
      })
    ).toEqual({ ...folder, name: 'Updated Recipes' });
    await deleteFishingKnowledgeFolder(accessToken, 'folder-1');
    expect(
      await createFishingKnowledgePage(accessToken, {
        folderId: 'folder-1',
        rawText: 'raw',
      })
    ).toEqual(page);
    expect(await getFishingKnowledgePage(accessToken, 'page-1')).toEqual(page);
    expect(
      await updateFishingKnowledgePage(accessToken, 'page-1', {
        rawText: 'updated raw',
      })
    ).toEqual({ ...page, rawText: 'updated raw' });
    expect(await reindexFishingKnowledgePage(accessToken, 'page-1')).toEqual({
      ...page,
      indexingStatus: 'pending',
    });
    await deleteFishingKnowledgePage(accessToken, 'page-1');

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://fishing-assistant.test',
      '/fishing/folders',
      accessToken,
      { method: 'POST', body: { name: 'Recipes' } }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://fishing-assistant.test',
      '/fishing/folders/folder-1',
      accessToken,
      {
        method: 'PATCH',
        body: { name: 'Updated Recipes', parentId: null, sortOrder: 0 },
      }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      3,
      'https://fishing-assistant.test',
      '/fishing/folders/folder-1',
      accessToken,
      { method: 'DELETE' }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      4,
      'https://fishing-assistant.test',
      '/fishing/pages',
      accessToken,
      { method: 'POST', body: { folderId: 'folder-1', rawText: 'raw' } }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      5,
      'https://fishing-assistant.test',
      '/fishing/pages/page-1',
      accessToken
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      6,
      'https://fishing-assistant.test',
      '/fishing/pages/page-1',
      accessToken,
      { method: 'PATCH', body: { rawText: 'updated raw' } }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      7,
      'https://fishing-assistant.test',
      '/fishing/pages/page-1/reindex',
      accessToken,
      { method: 'POST' }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      8,
      'https://fishing-assistant.test',
      '/fishing/pages/page-1',
      accessToken,
      { method: 'DELETE' }
    );
  });

  it('lists chats, creates a new chat, lists messages, and sends a message', async () => {
    const chats: FishingChat[] = [
      {
        id: 'chat-1',
        userId: 'user-1',
        title: 'Spring bait',
        lastMessagePreview: 'Use pinka',
        lastMessageAt: '2026-05-06T09:30:00.000Z',
        createdAt: '2026-05-06T09:00:00.000Z',
        updatedAt: '2026-05-06T10:00:00.000Z',
      },
    ];
    const createdChat: FishingChat = {
      id: 'chat-2',
      userId: 'user-1',
      title: 'New Chat',
      lastMessagePreview: '',
      lastMessageAt: '2026-05-06T09:30:00.000Z',
      createdAt: '2026-05-06T09:00:00.000Z',
      updatedAt: '2026-05-06T10:00:00.000Z',
    };
    const messages: FishingChatMessage[] = [
      {
        id: 'message-1',
        chatId: 'chat-1',
        userId: 'user-1',
        role: 'user',
        content: 'Hello',
        citations: [],
        createdAt: '2026-05-06T10:01:00.000Z',
      },
    ];
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ items: chats })
      .mockResolvedValueOnce({ chat: createdChat })
      .mockResolvedValueOnce({ items: messages })
      .mockResolvedValueOnce({
        chat: chats[0],
        message: {
          id: 'message-2',
          chatId: 'chat-1',
          userId: 'user-1',
          role: 'assistant',
          content: 'Use pinka',
          citations: [],
          createdAt: '2026-05-06T10:02:00.000Z',
          confidence: 'high',
        },
      });

    expect(await listFishingChats(accessToken)).toEqual(chats);
    expect(await createFishingChat(accessToken)).toEqual(createdChat);
    expect(await listFishingChatMessages(accessToken, 'chat-1')).toEqual(messages);
    await sendFishingChatMessage(accessToken, 'chat-1', 'Use pinka?');

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      'https://fishing-assistant.test',
      '/fishing/chats',
      accessToken
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      'https://fishing-assistant.test',
      '/fishing/chats',
      accessToken,
      { method: 'POST' }
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      3,
      'https://fishing-assistant.test',
      '/fishing/chats/chat-1/messages',
      accessToken
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      4,
      'https://fishing-assistant.test',
      '/fishing/chats/chat-1/messages',
      accessToken,
      { method: 'POST', body: { message: 'Use pinka?' } }
    );
  });
});
