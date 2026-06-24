import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listPrivateWhatsAppChatMessages,
  listPrivateWhatsAppChats,
  type ListPrivateWhatsAppChatMessagesOptions,
} from '@/services/whatsappApi';
import type { PrivateWhatsAppChat, PrivateWhatsAppMessage } from '@/types';

const CHAT_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 50;

export interface UsePrivateWhatsAppLogResult {
  chats: PrivateWhatsAppChat[];
  filteredChats: PrivateWhatsAppChat[];
  selectedChat: PrivateWhatsAppChat | undefined;
  selectedChatId: string | undefined;
  selectedDay: string | undefined;
  chatSearch: string;
  messages: PrivateWhatsAppMessage[];
  availableDays: string[];
  chatCursor: string | undefined;
  messageCursor: string | undefined;
  loadingChats: boolean;
  loadingMessages: boolean;
  loadingMoreChats: boolean;
  loadingMoreMessages: boolean;
  refreshing: boolean;
  error: string | null;
  setChatSearch: (value: string) => void;
  selectChat: (chatId: string) => void;
  selectDay: (dayKey: string) => void;
  clearDay: () => void;
  refresh: () => Promise<void>;
  loadMoreChats: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;
}

export function usePrivateWhatsAppLog(): UsePrivateWhatsAppLogResult {
  const { getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedChatId = searchParams.get('chat') ?? undefined;
  const selectedDay = searchParams.get('day') ?? undefined;
  const selectedChatIdRef = useRef<string | undefined>(selectedChatId);
  const selectedDataRequestIdRef = useRef(0);

  const [chats, setChats] = useState<PrivateWhatsAppChat[]>([]);
  const [chatSearch, setChatSearch] = useState('');
  const [messages, setMessages] = useState<PrivateWhatsAppMessage[]>([]);
  const [chatCursor, setChatCursor] = useState<string | undefined>(undefined);
  const [messageCursor, setMessageCursor] = useState<string | undefined>(undefined);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  const setSelectionParams = useCallback(
    (chatId: string | undefined, dayKey?: string): void => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (chatId === undefined || chatId === '') {
          next.delete('chat');
        } else {
          next.set('chat', chatId);
        }
        if (dayKey === undefined || dayKey === '') {
          next.delete('day');
        } else {
          next.set('day', dayKey);
        }
        return next;
      });
    },
    [setSearchParams]
  );

  const loadChats = useCallback(
    async (mode: 'replace' | 'append' = 'replace', cursor?: string): Promise<void> => {
      const append = mode === 'append';
      if (append && cursor === undefined) return;

      if (append) {
        setLoadingMoreChats(true);
      } else {
        setLoadingChats(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const response = await listPrivateWhatsAppChats(token, {
          limit: CHAT_PAGE_SIZE,
          ...(append && cursor !== undefined ? { cursor } : {}),
        });
        setChats((prev) => (append ? [...prev, ...response.chats] : response.chats));
        setChatCursor(response.nextCursor);

        if (!append && selectedChatIdRef.current === undefined && response.chats[0] !== undefined) {
          setSelectionParams(response.chats[0].id);
        }
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load private WhatsApp chats'));
      } finally {
        if (append) {
          setLoadingMoreChats(false);
        } else {
          setLoadingChats(false);
        }
      }
    },
    [getAccessToken, setSelectionParams]
  );

  const loadSelectedChatData = useCallback(
    async (mode: 'replace' | 'append' = 'replace', cursor?: string): Promise<void> => {
      if (selectedChatId === undefined) {
        selectedDataRequestIdRef.current += 1;
        setMessages([]);
        setMessageCursor(undefined);
        return;
      }

      const append = mode === 'append';
      if (append && cursor === undefined) return;

      const requestId = selectedDataRequestIdRef.current + 1;
      selectedDataRequestIdRef.current = requestId;

      if (append) {
        setLoadingMoreMessages(true);
      } else {
        setLoadingMessages(true);
        setMessages([]);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const messageOptions: ListPrivateWhatsAppChatMessagesOptions = {
          chatId: selectedChatId,
          limit: MESSAGE_PAGE_SIZE,
        };
        if (selectedDay !== undefined) {
          messageOptions.eventDayKey = selectedDay;
        }
        if (append && cursor !== undefined) {
          messageOptions.cursor = cursor;
        }

        const messageResponse = await listPrivateWhatsAppChatMessages(token, messageOptions);
        if (selectedDataRequestIdRef.current !== requestId) {
          return;
        }
        setMessages((prev) =>
          append ? [...prev, ...messageResponse.messages] : messageResponse.messages
        );
        setMessageCursor(messageResponse.nextCursor);
      } catch (err) {
        if (selectedDataRequestIdRef.current === requestId) {
          setError(getErrorMessage(err, 'Failed to load private WhatsApp messages'));
        }
      } finally {
        if (selectedDataRequestIdRef.current === requestId) {
          if (append) {
            setLoadingMoreMessages(false);
          } else {
            setLoadingMessages(false);
          }
        }
      }
    },
    [getAccessToken, selectedChatId, selectedDay]
  );

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    void loadSelectedChatData();
  }, [loadSelectedChatData]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await Promise.all([loadChats(), loadSelectedChatData()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadChats, loadSelectedChatData]);

  const loadMoreChats = useCallback(async (): Promise<void> => {
    await loadChats('append', chatCursor);
  }, [chatCursor, loadChats]);

  const loadMoreMessages = useCallback(async (): Promise<void> => {
    await loadSelectedChatData('append', messageCursor);
  }, [loadSelectedChatData, messageCursor]);

  const selectChat = useCallback(
    (chatId: string): void => {
      setSelectionParams(chatId);
    },
    [setSelectionParams]
  );

  const selectDay = useCallback(
    (dayKey: string): void => {
      const chatId = selectedChatIdRef.current;
      if (chatId !== undefined) {
        setSelectionParams(chatId, dayKey);
      }
    },
    [setSelectionParams]
  );

  const clearDay = useCallback((): void => {
    const chatId = selectedChatIdRef.current;
    if (chatId !== undefined) {
      setSelectionParams(chatId);
    }
  }, [setSelectionParams]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId),
    [chats, selectedChatId]
  );

  const filteredChats = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    if (query === '') return chats;
    return chats.filter((chat) => {
      const values = [chat.displayName, chat.chatType, chat.id];
      return values.some((value) => value?.toLowerCase().includes(query) === true);
    });
  }, [chatSearch, chats]);

  const availableDays = useMemo(() => {
    const days = new Set<string>();
    for (const message of messages) {
      days.add(message.eventDayKey ?? message.eventTimestamp.slice(0, 10));
    }
    return [...days].sort((a, b) => b.localeCompare(a));
  }, [messages]);

  return {
    chats,
    filteredChats,
    selectedChat,
    selectedChatId,
    selectedDay,
    chatSearch,
    messages,
    availableDays,
    chatCursor,
    messageCursor,
    loadingChats,
    loadingMessages,
    loadingMoreChats,
    loadingMoreMessages,
    refreshing,
    error,
    setChatSearch,
    selectChat,
    selectDay,
    clearDay,
    refresh,
    loadMoreChats,
    loadMoreMessages,
  };
}
