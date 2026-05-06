import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { ApiError } from '@/services/apiClient';
import {
  createFishingChat,
  listFishingChatMessages,
  listFishingChats,
  sendFishingChatMessage,
} from '@/services/fishingAssistantApi';
import type {
  FishingChat,
  FishingChatMessage,
  SendFishingChatMessageResponse,
} from '@/types/fishingAssistant';

export interface UseFishingChatResult {
  readonly chats: readonly FishingChat[];
  readonly messages: readonly FishingChatMessage[];
  readonly loading: boolean;
  readonly sending: boolean;
  readonly error: string | null;
  readonly errorCode: string | null;
  readonly refresh: () => Promise<void>;
  readonly ensureChat: () => Promise<FishingChat>;
  readonly createChat: () => Promise<FishingChat>;
  readonly sendMessage: (text: string) => Promise<SendFishingChatMessageResponse | null>;
}

export function useFishingChat(selectedChatId?: string): UseFishingChatResult {
  const { getAccessToken } = useAuth();
  const [chats, setChats] = useState<FishingChat[]>([]);
  const [messages, setMessages] = useState<FishingChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  const loadChatState = useCallback(
    async (chatId?: string): Promise<void> => {
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const token = await getAccessToken();
        const chatItems = await listFishingChats(token);
        const messageItems = chatId !== undefined
          ? await listFishingChatMessages(token, chatId)
          : [];
        if (!mountedRef.current) return;
        setChats(chatItems);
        setMessages(messageItems);
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load Fishing Assistant chat'));
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    void loadChatState(selectedChatId);
  }, [loadChatState, selectedChatId]);

  const createChat = useCallback(async (): Promise<FishingChat> => {
    const token = await getAccessToken();
    const chat = await createFishingChat(token);
    const [chatItems, messageItems] = await Promise.all([
      listFishingChats(token),
      listFishingChatMessages(token, chat.id),
    ]);
    if (mountedRef.current) {
      setChats(chatItems);
      setMessages(messageItems);
    }
    return chat;
  }, [getAccessToken]);

  const ensureChat = useCallback(async (): Promise<FishingChat> => {
    if (selectedChatId !== undefined) {
      const existing = chats.find((chat) => chat.id === selectedChatId);
      if (existing !== undefined) {
        return existing;
      }
    }
    return await createChat();
  }, [chats, createChat, selectedChatId]);

  const sendMessage = useCallback(
    async (text: string): Promise<SendFishingChatMessageResponse | null> => {
      const trimmed = text.trim();
      if (trimmed === '') {
        return null;
      }

      setSending(true);
      setError(null);
      setErrorCode(null);
      try {
        const targetChatId = selectedChatId ?? (await ensureChat()).id;
        const token = await getAccessToken();
        const response = await sendFishingChatMessage(token, targetChatId, trimmed);
        const [chatItems, messageItems] = await Promise.all([
          listFishingChats(token),
          listFishingChatMessages(token, response.chat.id),
        ]);
        if (mountedRef.current) {
          setChats(chatItems);
          setMessages(messageItems);
        }
        return response;
      } catch (err: unknown) {
        if (mountedRef.current) {
          if (err instanceof ApiError) {
            setErrorCode(err.code);
          }
          setError(getErrorMessage(err, 'Failed to send Fishing Assistant message'));
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setSending(false);
        }
      }
    },
    [ensureChat, getAccessToken, selectedChatId]
  );

  return {
    chats,
    messages,
    loading,
    sending,
    error,
    errorCode,
    refresh: async (): Promise<void> => {
      await loadChatState(selectedChatId);
    },
    ensureChat,
    createChat,
    sendMessage,
  };
}
