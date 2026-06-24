import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listPrivateWhatsAppMessages,
  listPrivateWhatsAppSenderDays,
  listPrivateWhatsAppSenders,
  type ListPrivateWhatsAppMessagesOptions,
  type ListPrivateWhatsAppSenderDaysOptions,
} from '@/services/whatsappApi';
import type {
  PrivateWhatsAppMessage,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderDay,
} from '@/types';

const SENDER_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 50;
const SENDER_DAY_PAGE_SIZE = 60;

export interface UsePrivateWhatsAppLogResult {
  senders: PrivateWhatsAppSender[];
  filteredSenders: PrivateWhatsAppSender[];
  selectedSender: PrivateWhatsAppSender | undefined;
  selectedSenderKey: string | undefined;
  selectedDay: string | undefined;
  senderSearch: string;
  messages: PrivateWhatsAppMessage[];
  senderDays: PrivateWhatsAppSenderDay[];
  senderCursor: string | undefined;
  messageCursor: string | undefined;
  loadingSenders: boolean;
  loadingMessages: boolean;
  loadingSenderDays: boolean;
  loadingMoreSenders: boolean;
  loadingMoreMessages: boolean;
  refreshing: boolean;
  error: string | null;
  setSenderSearch: (value: string) => void;
  selectSender: (senderKey: string) => void;
  selectDay: (dayKey: string) => void;
  clearDay: () => void;
  refresh: () => Promise<void>;
  loadMoreSenders: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;
}

export function usePrivateWhatsAppLog(): UsePrivateWhatsAppLogResult {
  const { getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSenderKey = searchParams.get('sender') ?? undefined;
  const selectedDay = searchParams.get('day') ?? undefined;
  const selectedSenderKeyRef = useRef<string | undefined>(selectedSenderKey);
  const selectedDataRequestIdRef = useRef(0);

  const [senders, setSenders] = useState<PrivateWhatsAppSender[]>([]);
  const [senderSearch, setSenderSearch] = useState('');
  const [messages, setMessages] = useState<PrivateWhatsAppMessage[]>([]);
  const [senderDays, setSenderDays] = useState<PrivateWhatsAppSenderDay[]>([]);
  const [senderCursor, setSenderCursor] = useState<string | undefined>(undefined);
  const [messageCursor, setMessageCursor] = useState<string | undefined>(undefined);
  const [loadingSenders, setLoadingSenders] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingSenderDays, setLoadingSenderDays] = useState(false);
  const [loadingMoreSenders, setLoadingMoreSenders] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    selectedSenderKeyRef.current = selectedSenderKey;
  }, [selectedSenderKey]);

  const setSelectionParams = useCallback(
    (senderKey: string | undefined, dayKey?: string): void => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (senderKey === undefined || senderKey === '') {
          next.delete('sender');
        } else {
          next.set('sender', senderKey);
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

  const loadSenders = useCallback(
    async (mode: 'replace' | 'append' = 'replace', cursor?: string): Promise<void> => {
      const append = mode === 'append';
      if (append && cursor === undefined) return;

      if (append) {
        setLoadingMoreSenders(true);
      } else {
        setLoadingSenders(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const response = await listPrivateWhatsAppSenders(token, {
          limit: SENDER_PAGE_SIZE,
          ...(append && cursor !== undefined ? { cursor } : {}),
        });
        setSenders((prev) => (append ? [...prev, ...response.senders] : response.senders));
        setSenderCursor(response.nextCursor);

        if (
          !append &&
          selectedSenderKeyRef.current === undefined &&
          response.senders[0] !== undefined
        ) {
          setSelectionParams(response.senders[0].senderKey);
        }
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load private WhatsApp senders'));
      } finally {
        if (append) {
          setLoadingMoreSenders(false);
        } else {
          setLoadingSenders(false);
        }
      }
    },
    [getAccessToken, setSelectionParams]
  );

  const loadSelectedSenderData = useCallback(
    async (mode: 'replace' | 'append' = 'replace', cursor?: string): Promise<void> => {
      if (selectedSenderKey === undefined) {
        selectedDataRequestIdRef.current += 1;
        setMessages([]);
        setSenderDays([]);
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
        setLoadingSenderDays(true);
        setMessages([]);
        setSenderDays([]);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const messageOptions: ListPrivateWhatsAppMessagesOptions = {
          senderKey: selectedSenderKey,
          limit: MESSAGE_PAGE_SIZE,
        };
        if (selectedDay !== undefined) {
          messageOptions.eventDayKey = selectedDay;
        }
        if (append && cursor !== undefined) {
          messageOptions.cursor = cursor;
        }

        if (append) {
          const messageResponse = await listPrivateWhatsAppMessages(token, messageOptions);
          if (selectedDataRequestIdRef.current !== requestId) {
            return;
          }
          setMessages((prev) => [...prev, ...messageResponse.messages]);
          setMessageCursor(messageResponse.nextCursor);
          return;
        }

        const senderDayOptions: ListPrivateWhatsAppSenderDaysOptions = {
          senderKey: selectedSenderKey,
          limit: SENDER_DAY_PAGE_SIZE,
        };
        const [messageResponse, senderDayResponse] = await Promise.all([
          listPrivateWhatsAppMessages(token, messageOptions),
          listPrivateWhatsAppSenderDays(token, senderDayOptions),
        ]);
        if (selectedDataRequestIdRef.current !== requestId) {
          return;
        }
        setMessages(messageResponse.messages);
        setMessageCursor(messageResponse.nextCursor);
        setSenderDays(senderDayResponse.senderDays);
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
            setLoadingSenderDays(false);
          }
        }
      }
    },
    [getAccessToken, selectedDay, selectedSenderKey]
  );

  useEffect(() => {
    void loadSenders();
  }, [loadSenders]);

  useEffect(() => {
    void loadSelectedSenderData();
  }, [loadSelectedSenderData]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await Promise.all([loadSenders(), loadSelectedSenderData()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadSelectedSenderData, loadSenders]);

  const loadMoreSenders = useCallback(async (): Promise<void> => {
    await loadSenders('append', senderCursor);
  }, [loadSenders, senderCursor]);

  const loadMoreMessages = useCallback(async (): Promise<void> => {
    await loadSelectedSenderData('append', messageCursor);
  }, [loadSelectedSenderData, messageCursor]);

  const selectSender = useCallback(
    (senderKey: string): void => {
      setSelectionParams(senderKey);
    },
    [setSelectionParams]
  );

  const selectDay = useCallback(
    (dayKey: string): void => {
      const senderKey = selectedSenderKeyRef.current;
      if (senderKey !== undefined) {
        setSelectionParams(senderKey, dayKey);
      }
    },
    [setSelectionParams]
  );

  const clearDay = useCallback((): void => {
    const senderKey = selectedSenderKeyRef.current;
    if (senderKey !== undefined) {
      setSelectionParams(senderKey);
    }
  }, [setSelectionParams]);

  const selectedSender = useMemo(
    () => senders.find((sender) => sender.senderKey === selectedSenderKey),
    [selectedSenderKey, senders]
  );

  const filteredSenders = useMemo(() => {
    const query = senderSearch.trim().toLowerCase();
    if (query === '') return senders;
    return senders.filter((sender) => {
      const values = [
        sender.senderDisplayName,
        sender.senderPhoneNumber,
        sender.senderPhoneNumberNormalized,
        sender.senderKey,
      ];
      return values.some((value) => value?.toLowerCase().includes(query) === true);
    });
  }, [senderSearch, senders]);

  return {
    senders,
    filteredSenders,
    selectedSender,
    selectedSenderKey,
    selectedDay,
    senderSearch,
    messages,
    senderDays,
    senderCursor,
    messageCursor,
    loadingSenders,
    loadingMessages,
    loadingSenderDays,
    loadingMoreSenders,
    loadingMoreMessages,
    refreshing,
    error,
    setSenderSearch,
    selectSender,
    selectDay,
    clearDay,
    refresh,
    loadMoreSenders,
    loadMoreMessages,
  };
}
