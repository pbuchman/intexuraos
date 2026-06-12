/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '@/services/apiClient';

const { mockGetAccessToken, mockApi } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockApi: {
    listFishingChats: vi.fn(),
    listFishingChatMessages: vi.fn(),
    createFishingChat: vi.fn(),
    sendFishingChatMessage: vi.fn(),
  },
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/fishingAssistantApi', () => mockApi);

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string =>
    err instanceof Error ? err.message : defaultMsg,
}));

import { useFishingChat } from '../useFishingChat.js';

describe('useFishingChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('tok');
  });

  it('loads chats and messages for the selected chat', async () => {
    mockApi.listFishingChats.mockResolvedValue([
      {
        id: 'chat-1',
        userId: 'user-1',
        title: 'Spring Bait',
        lastMessagePreview: 'Use pinka',
        lastMessageAt: '',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    mockApi.listFishingChatMessages.mockResolvedValue([
      {
        id: 'message-1',
        chatId: 'chat-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Use pinka',
        citations: [],
        createdAt: '',
      },
    ]);

    const { result } = renderHook(() => useFishingChat('chat-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chats).toHaveLength(1);
    expect(result.current.messages).toHaveLength(1);
  });

  it('creates a chat on demand and sends messages to it', async () => {
    mockApi.listFishingChats
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'chat-1',
          userId: 'user-1',
          title: 'New Chat',
          lastMessagePreview: '',
          lastMessageAt: '',
          createdAt: '',
          updatedAt: '',
        },
      ]);
    mockApi.listFishingChatMessages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'message-1',
          chatId: 'chat-1',
          userId: 'user-1',
          role: 'assistant',
          content: 'Use pinka',
          citations: [],
          createdAt: '',
        },
      ]);
    mockApi.createFishingChat.mockResolvedValue({
      id: 'chat-1',
      userId: 'user-1',
      title: 'New Chat',
      lastMessagePreview: '',
      lastMessageAt: '',
      createdAt: '',
      updatedAt: '',
    });
    mockApi.sendFishingChatMessage.mockResolvedValue({
      chat: {
        id: 'chat-1',
        userId: 'user-1',
        title: 'Spring Bait',
        lastMessagePreview: 'Use pinka',
        lastMessageAt: '',
        createdAt: '',
        updatedAt: '',
      },
      message: {
        id: 'message-1',
        chatId: 'chat-1',
        userId: 'user-1',
        role: 'assistant',
        content: 'Use pinka',
        citations: [],
        createdAt: '',
      },
    });

    const { result } = renderHook(() => useFishingChat());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.ensureChat();
      await result.current.sendMessage('Use pinka?');
    });

    expect(mockApi.createFishingChat).toHaveBeenCalledWith('tok');
    expect(mockApi.sendFishingChatMessage).toHaveBeenCalledWith('tok', 'chat-1', 'Use pinka?');
  });

  it('exposes the NO_API_KEY error code so the page can link to API key settings', async () => {
    mockApi.listFishingChats.mockResolvedValue([
      {
        id: 'chat-1',
        userId: 'user-1',
        title: 'Spring Bait',
        lastMessagePreview: 'Use pinka',
        lastMessageAt: '',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    mockApi.listFishingChatMessages.mockResolvedValue([]);
    mockApi.sendFishingChatMessage.mockRejectedValue(
      new ApiError(
        'NO_API_KEY',
        'OpenRouter API key is required for Fishing Assistant chat.',
        400
      )
    );

    const { result } = renderHook(() => useFishingChat('chat-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.sendMessage('Use pinka?');
    });

    expect(result.current.errorCode).toBe('NO_API_KEY');
    expect(result.current.error).toContain('OpenRouter API key is required');
  });
});
