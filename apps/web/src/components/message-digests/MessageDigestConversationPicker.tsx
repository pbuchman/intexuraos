import {
  AlertTriangle,
  Check,
  LoaderCircle,
  MessageSquare,
  Search,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context';
import { listPrivateWhatsAppChats } from '@/services/whatsappApi';
import type { PrivateWhatsAppChat } from '@/types';
import { formatRelative } from '@/utils/dateFormat';

const CHAT_PAGE_SIZE = 50;

type ConversationTab = 'all' | 'group' | 'direct';

export interface MessageDigestConversationSelection {
  chatId: string;
  chatType: 'group' | 'direct';
  displayName: string;
  messageCount?: number;
  participantCount?: number;
  lastActivityAt?: string;
}

interface MessageDigestConversationPickerProps {
  open: boolean;
  value: MessageDigestConversationSelection | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: MessageDigestConversationSelection) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const TABS: readonly { value: ConversationTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'group', label: 'Groups' },
  { value: 'direct', label: 'Direct' },
];

export function MessageDigestConversationPicker({
  open,
  value,
  onOpenChange,
  onSelect,
  returnFocusRef,
}: MessageDigestConversationPickerProps): React.JSX.Element {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const [chats, setChats] = useState<PrivateWhatsAppChat[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ConversationTab>('all');
  const [selectedChatId, setSelectedChatId] = useState<string | null>(value?.chatId ?? null);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const appendInFlightRef = useRef(false);

  const loadChats = useCallback(
    async (mode: 'replace' | 'append', cursor?: string): Promise<void> => {
      if (mode === 'append' && (appendInFlightRef.current || cursor === undefined)) return;
      if (mode === 'append') appendInFlightRef.current = true;
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      if (mode === 'replace') {
        setIsInitialLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
        setLoadMoreError(null);
      }

      try {
        const accessToken = await getAccessToken();
        if (requestSequenceRef.current !== requestId) return;
        const response = await listPrivateWhatsAppChats(accessToken, {
          limit: CHAT_PAGE_SIZE,
          ...(mode === 'append' && cursor !== undefined ? { cursor } : {}),
        });
        if (requestSequenceRef.current !== requestId) return;
        setChats((current) =>
          mode === 'append' ? appendUniqueChats(current, response.chats) : response.chats
        );
        setNextCursor(response.nextCursor ?? null);
      } catch (loadError) {
        if (requestSequenceRef.current !== requestId) return;
        const message = getErrorMessage(loadError, 'Failed to load WhatsApp conversations');
        if (mode === 'replace') setError(message);
        else setLoadMoreError(message);
      } finally {
        if (requestSequenceRef.current === requestId) {
          if (mode === 'replace') setIsInitialLoading(false);
          else setIsLoadingMore(false);
        }
        if (mode === 'append') appendInFlightRef.current = false;
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    appendInFlightRef.current = false;
    if (!open) return;

    setChats([]);
    setNextCursor(null);
    setQuery('');
    setTab('all');
    setSelectedChatId(value?.chatId ?? null);
    setError(null);
    setLoadMoreError(null);
    void loadChats('replace');
    return (): void => {
      requestSequenceRef.current += 1;
      appendInFlightRef.current = false;
    };
  }, [authSubject, loadChats, open, value?.chatId]);

  const visibleChats = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return chats.filter((chat) => {
      if (tab !== 'all' && chat.chatType !== tab) return false;
      if (normalizedQuery === '') return true;
      return getChatDisplayName(chat).toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [chats, query, tab]);

  const selectedChat = chats.find(
    (chat) => chat.id === selectedChatId && chat.chatType !== 'unknown'
  );

  const commitSelection = (): void => {
    if (selectedChat === undefined || selectedChat.chatType === 'unknown') return;
    onSelect({
      chatId: selectedChat.id,
      chatType: selectedChat.chatType,
      displayName: getChatDisplayName(selectedChat),
      messageCount: selectedChat.messageCount,
      participantCount: selectedChat.participantCount,
      lastActivityAt: selectedChat.lastEventAt,
    });
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a WhatsApp conversation"
      description="Select one mirrored group or direct conversation as the source for this digest."
      hideTitle
      padded={false}
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
      contentClassName="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] min-w-0 flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(44rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
    >
      <header className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            Choose a WhatsApp conversation
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
            Groups and direct chats come from your Private WhatsApp Mirror.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close conversation picker"
          onClick={(): void => {
            onOpenChange(false);
          }}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="space-y-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-6">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Search conversations
            </span>
            <span className="relative block min-w-0">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                aria-label="Search conversations"
                value={query}
                onChange={(event): void => {
                  setQuery(event.target.value);
                }}
                placeholder="Search loaded conversations"
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </span>
          </label>
          <div
            role="group"
            aria-label="Conversation type"
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={tab === item.value}
                onClick={(): void => {
                  setTab(item.value);
                }}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  tab === item.value
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4">
          {isInitialLoading ? (
            <div
              role="status"
              className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400"
            >
              <LoaderCircle
                aria-hidden="true"
                className="h-5 w-5 animate-spin text-blue-600 motion-reduce:animate-none"
              />
              Loading conversations…
            </div>
          ) : null}

          {!isInitialLoading && error !== null ? (
            <div
              role="alert"
              className="m-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
            >
              <p>{error}</p>
              <button
                type="button"
                onClick={(): void => void loadChats('replace')}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-red-700 px-4 font-semibold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
              >
                Try again
              </button>
            </div>
          ) : null}

          {!isInitialLoading && error === null && chats.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
              <MessageSquare
                aria-hidden="true"
                className="h-9 w-9 text-slate-300 dark:text-slate-700"
              />
              <p className="mt-3 font-semibold text-slate-900 dark:text-slate-100">
                No mirrored conversations yet
              </p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
                Once Private WhatsApp Mirror receives conversation history, it will appear here.
              </p>
            </div>
          ) : null}

          {!isInitialLoading && error === null && chats.length > 0 && visibleChats.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center">
              <Search aria-hidden="true" className="h-8 w-8 text-slate-300 dark:text-slate-700" />
              <p className="mt-3 font-semibold text-slate-900 dark:text-slate-100">
                No conversations match
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Clear the search or choose another conversation type.
              </p>
            </div>
          ) : null}

          {!isInitialLoading && error === null && visibleChats.length > 0 ? (
            <ul className="grid min-w-0 gap-2">
              {visibleChats.map((chat) => (
                <ConversationRow
                  key={chat.id}
                  chat={chat}
                  selected={selectedChatId === chat.id}
                  onSelect={setSelectedChatId}
                />
              ))}
            </ul>
          ) : null}

          {loadMoreError !== null ? (
            <div
              role="alert"
              className="mx-2 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {loadMoreError}
            </div>
          ) : null}

          {!isInitialLoading && error === null && nextCursor !== null ? (
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={(): void => void loadChats('append', nextCursor)}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60 dark:text-blue-300 dark:hover:bg-blue-950/40"
            >
              {isLoadingMore ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {isLoadingMore ? 'Loading more…' : 'Load more conversations'}
            </button>
          ) : null}
        </div>
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/50 sm:flex-row sm:justify-end sm:px-6">
        <button
          type="button"
          onClick={(): void => {
            onOpenChange(false);
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={selectedChat === undefined}
          onClick={commitSelection}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          Use conversation
        </button>
      </footer>
    </Modal>
  );
}

function ConversationRow({
  chat,
  selected,
  onSelect,
}: {
  chat: PrivateWhatsAppChat;
  selected: boolean;
  onSelect: (chatId: string) => void;
}): React.JSX.Element {
  const unsupported = chat.chatType === 'unknown';
  const Icon = chat.chatType === 'group' ? UsersRound : UserRound;
  const typeLabel =
    chat.chatType === 'group' ? 'Group' : chat.chatType === 'direct' ? 'Direct' : 'Unknown';
  const participantCopy =
    chat.chatType === 'group' ? `, ${String(chat.participantCount)} participants` : '';
  const accessibleName = `${getChatDisplayName(chat)}, ${typeLabel}${participantCopy}, ${String(chat.messageCount)} messages${unsupported ? ', Unsupported conversation type' : ''}`;
  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={unsupported}
        aria-label={accessibleName}
        aria-pressed={unsupported ? undefined : selected}
        onClick={(): void => {
          onSelect(chat.id);
        }}
        className={`flex min-h-16 w-full min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed ${
          selected
            ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40'
            : unsupported
              ? 'border-slate-200 bg-slate-50 opacity-70 dark:border-slate-800 dark:bg-slate-950/50'
              : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800'
        }`}
      >
        <span
          className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
        >
          {unsupported ? (
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Icon aria-hidden="true" className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold text-slate-950 dark:text-slate-50">
            {getChatDisplayName(chat)}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{typeLabel}</span>
            {chat.chatType === 'group' ? (
              <span>{String(chat.participantCount)} participants</span>
            ) : null}
            <span>{String(chat.messageCount)} messages</span>
            <span>Active {formatRelative(chat.lastEventAt)}</span>
          </span>
          {unsupported ? (
            <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-300">
              Unsupported conversation type
            </span>
          ) : null}
        </span>
        {selected && !unsupported ? (
          <Check
            aria-hidden="true"
            className="mt-1 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400"
          />
        ) : null}
      </button>
    </li>
  );
}

function appendUniqueChats(
  current: PrivateWhatsAppChat[],
  incoming: PrivateWhatsAppChat[]
): PrivateWhatsAppChat[] {
  const seen = new Set(current.map((chat) => chat.id));
  return [...current, ...incoming.filter((chat) => !seen.has(chat.id))];
}

function getChatDisplayName(chat: PrivateWhatsAppChat): string {
  const displayName = chat.displayName?.trim();
  if (displayName !== undefined && displayName !== '') return displayName;
  return chat.chatType === 'group' ? 'Unnamed group' : 'Unnamed conversation';
}
