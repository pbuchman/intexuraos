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
      { id: 'folder-1', userId: 'user-1', name: 'Recipes', parentId: null, sortOrder: 0, pageCount: 1, createdAt: '', updatedAt: '' },
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
        createdAt: '',
        updatedAt: '',
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
      createdAt: '',
      updatedAt: '',
    };
    const folder: FishingKnowledgeFolder = {
      id: 'folder-1',
      userId: 'user-1',
      name: 'Recipes',
      parentId: null,
      sortOrder: 0,
      pageCount: 1,
      createdAt: '',
      updatedAt: '',
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
        lastMessageAt: '',
        createdAt: '',
        updatedAt: '',
      },
    ];
    const createdChat: FishingChat = {
      id: 'chat-2',
      userId: 'user-1',
      title: 'New Chat',
      lastMessagePreview: '',
      lastMessageAt: '',
      createdAt: '',
      updatedAt: '',
    };
    const messages: FishingChatMessage[] = [
      {
        id: 'message-1',
        chatId: 'chat-1',
        userId: 'user-1',
        role: 'user',
        content: 'Hello',
        citations: [],
        createdAt: '',
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
          createdAt: '',
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
