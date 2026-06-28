import { useMemo } from 'react';
import {
  CalendarDays,
  FileText,
  Image,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Button, ErrorBanner, Layout } from '@/components';
import { PrivateWhatsAppImagePreview } from '@/components/whatsapp/PrivateWhatsAppImagePreview';
import { usePrivateWhatsAppLog } from '@/hooks/usePrivateWhatsAppLog';
import { formatDateTimeCompact, formatRelative } from '@/utils/dateFormat';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageType,
} from '@/types';

function getChatLabel(chat: PrivateWhatsAppChat | undefined, fallback?: string): string {
  return chat?.displayName ?? fallback ?? chat?.id ?? 'Unknown chat';
}

function getChatMeta(chat: PrivateWhatsAppChat): string {
  const messageCount = chat.messageCount;
  if (chat.chatType === 'group') {
    const participantCount = chat.participantCount;
    return `${String(messageCount)} messages · ${String(participantCount)} participants`;
  }
  return `${String(messageCount)} messages`;
}

function getMessageSenderLabel(message: PrivateWhatsAppMessage): string {
  if (message.direction === 'outgoing') {
    return 'You';
  }
  return (
    message.senderDisplayName ??
    message.senderPhoneNumber ??
    message.senderPhoneNumberNormalized ??
    message.senderKey ??
    'Unknown sender'
  );
}

function getDayKey(message: PrivateWhatsAppMessage): string {
  return message.eventDayKey ?? message.eventTimestamp.slice(0, 10);
}

function formatDayLabel(dayKey: string): string {
  const [yearValue, monthValue, dayValue] = dayKey.split('-');
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return dayKey;
  }

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatMessageTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMessageTypeClass(messageType: PrivateWhatsAppMessageType): string {
  switch (messageType) {
    case 'text':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'image':
    case 'video':
    case 'sticker':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300';
    case 'audio':
      return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

function hasStoredImage(message: PrivateWhatsAppMessage): boolean {
  return (
    message.messageType === 'image' &&
    message.media?.storageStatus === 'stored' &&
    message.media.hasMedia === true &&
    message.media.hasThumbnail === true
  );
}

function MessageTranscription({ message }: { message: PrivateWhatsAppMessage }): React.JSX.Element | null {
  const transcription = message.messageType === 'audio' ? message.transcription : undefined;
  if (transcription === undefined) {
    return null;
  }

  if (transcription.status === 'completed' && transcription.text !== undefined) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/30">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <Mic className="h-3.5 w-3.5" />
          <span>Transcript</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900 dark:text-slate-100">
          {transcription.text}
        </p>
      </div>
    );
  }

  if (transcription.status === 'failed') {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
          <Mic className="h-3.5 w-3.5" />
          <span>Transcript failed</span>
        </div>
        {transcription.error?.message !== undefined ? (
          <p className="break-words">{transcription.error.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{transcription.status === 'pending' ? 'Queued' : 'Transcribing'}</span>
    </div>
  );
}

function MessageBody({ message }: { message: PrivateWhatsAppMessage }): React.JSX.Element {
  const hasText = message.text !== undefined && message.text.trim() !== '';
  const transcription = <MessageTranscription message={message} />;

  if (hasStoredImage(message)) {
    return (
      <div className="space-y-3">
        <PrivateWhatsAppImagePreview message={message} />
        {hasText ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900 dark:text-slate-100">
            {message.text}
          </p>
        ) : null}
        {transcription}
      </div>
    );
  }

  if (hasText) {
    return (
      <div className="space-y-3">
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900 dark:text-slate-100">
          {message.text}
        </p>
        {transcription}
      </div>
    );
  }

  const mediaName =
    message.media?.fileName ?? message.media?.mimeType ?? `${message.messageType} message`;
  const Icon = message.messageType === 'image' ? Image : FileText;

  return (
    <div className="space-y-3">
      <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{mediaName}</span>
      </div>
      {transcription}
    </div>
  );
}

function groupMessagesByDay(
  messages: PrivateWhatsAppMessage[]
): { dayKey: string; messages: PrivateWhatsAppMessage[] }[] {
  const groups = new Map<string, PrivateWhatsAppMessage[]>();
  for (const message of messages) {
    const dayKey = getDayKey(message);
    const group = groups.get(dayKey) ?? [];
    group.push(message);
    groups.set(dayKey, group);
  }
  return Array.from(groups, ([dayKey, dayMessages]) => ({
    dayKey,
    messages: dayMessages,
  }));
}

export function PrivateWhatsAppLogPage(): React.JSX.Element {
  const log = usePrivateWhatsAppLog();
  const selectedChatLabel = getChatLabel(log.selectedChat, log.selectedChatId);
  const groupedMessages = useMemo(() => groupMessagesByDay(log.messages), [log.messages]);
  const hasNoChats = !log.loadingChats && log.chats.length === 0;
  const hasNoMessages =
    !log.loadingMessages && log.selectedChatId !== undefined && log.messages.length === 0;
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of log.messages) {
      const dayKey = getDayKey(message);
      counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1);
    }
    return counts;
  }, [log.messages]);

  return (
    <Layout>
      <div data-testid="private-whatsapp-log-shell" className="flex w-full min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">
              Private WhatsApp
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Read-only conversation log for direct and group chats.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={(): void => {
              void log.refresh();
            }}
            isLoading={log.refreshing}
            loadingText="Refreshing"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </header>

        <ErrorBanner message={log.error} />

        <div className="grid min-h-[calc(100vh-12rem)] grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
          <aside
            data-testid="private-whatsapp-chat-rail"
            className="flex max-h-[45vh] min-h-0 flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:max-h-[28rem] xl:max-h-none"
          >
            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
              <label className="sr-only" htmlFor="private-whatsapp-chat-search">
                Search chats
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  id="private-whatsapp-chat-search"
                  type="search"
                  value={log.chatSearch}
                  onChange={(event): void => {
                    log.setChatSearch(event.target.value);
                  }}
                  placeholder="Search chats"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:bg-slate-900 dark:focus:ring-blue-900/40"
                />
              </div>
            </div>

            <div className="min-h-[14rem] flex-1 overflow-y-auto p-2">
              {log.loadingChats ? (
                <div className="flex items-center justify-center py-10">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                </div>
              ) : null}

              {hasNoChats ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    No private WhatsApp messages yet.
                  </p>
                </div>
              ) : null}

              {!log.loadingChats && log.chats.length > 0 && log.filteredChats.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  No chats match this search.
                </div>
              ) : null}

              <div className="space-y-1">
                {log.filteredChats.map((chat) => {
                  const selected = chat.id === log.selectedChatId;
                  const Icon = chat.chatType === 'group' ? UsersRound : UserRound;
                  return (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={(): void => {
                        log.selectChat(chat.id);
                      }}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        selected
                          ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
                          : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
                              {getChatLabel(chat)}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                              {getChatMeta(chat)}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {String(chat.messageCount)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {formatRelative(chat.lastEventAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {log.chatCursor !== undefined ? (
              <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={(): void => {
                    void log.loadMoreChats();
                  }}
                  isLoading={log.loadingMoreChats}
                  loadingText="Loading"
                >
                  Load more chats
                </Button>
              </div>
            ) : null}
          </aside>

          <section
            data-testid="private-whatsapp-message-timeline"
            className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="sticky top-16 z-10 border-b border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {log.selectedChat?.chatType === 'group' ? (
                      <UsersRound className="h-5 w-5 text-slate-400" />
                    ) : (
                      <UserRound className="h-5 w-5 text-slate-400" />
                    )}
                    <h3 className="truncate text-lg font-semibold text-slate-950 dark:text-slate-50">
                      {log.selectedChatId === undefined ? 'Select a chat' : selectedChatLabel}
                    </h3>
                  </div>
                  {log.selectedChat !== undefined ? (
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {getChatMeta(log.selectedChat)} · Last seen{' '}
                      {formatDateTimeCompact(log.selectedChat.lastEventAt)}
                    </p>
                  ) : null}
                </div>
                {log.selectedChat !== undefined ? (
                  <label className="inline-flex select-none items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <Mic className="h-4 w-4 text-slate-400" />
                    <span>Transcripts</span>
                    <input
                      role="switch"
                      type="checkbox"
                      className="sr-only"
                      checked={log.selectedChat.transcriptionEnabled === true}
                      disabled={log.transcriptionToggleChatId === log.selectedChat.id}
                      aria-label="Transcripts"
                      onChange={(event): void => {
                        void log.setChatTranscriptionEnabled(
                          log.selectedChat?.id ?? '',
                          event.currentTarget.checked
                        );
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        log.selectedChat.transcriptionEnabled === true
                          ? 'bg-blue-600'
                          : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          log.selectedChat.transcriptionEnabled === true
                            ? 'translate-x-4'
                            : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </label>
                ) : null}
              </div>

              {log.selectedChatId !== undefined ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={log.clearDay}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      log.selectedDay === undefined
                        ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    All days
                  </button>
                  {log.availableDays.map((dayKey) => (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={(): void => {
                        log.selectDay(dayKey);
                      }}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        log.selectedDay === dayKey
                          ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span>{dayKey}</span>
                      <span className="text-xs text-slate-400">
                        {String(dayCounts.get(dayKey) ?? 0)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="min-h-[28rem] p-4">
              {log.loadingMessages ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                </div>
              ) : null}

              {hasNoMessages ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {log.selectedDay === undefined ? 'No messages for this chat.' : 'No messages for this day.'}
                  </p>
                </div>
              ) : null}

              {!log.loadingMessages && log.selectedChatId === undefined ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <UserRound className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Select a chat to read messages.
                  </p>
                </div>
              ) : null}

              <div className="space-y-6">
                {groupedMessages.map((group) => (
                  <section key={group.dayKey} aria-label={`Messages for ${group.dayKey}`}>
                    <div className="sticky top-[11.5rem] z-0 mb-3 flex justify-center">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {formatDayLabel(group.dayKey)}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {group.messages.map((message) => {
                        const outgoing = message.direction === 'outgoing';
                        return (
                          <article
                            key={message.id}
                            className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[min(42rem,100%)] rounded-lg border px-4 py-3 ${
                                outgoing
                                  ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'
                                  : 'border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900'
                              }`}
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                  {getMessageSenderLabel(message)}
                                </span>
                                <time
                                  dateTime={message.eventTimestamp}
                                  className="text-xs font-medium text-slate-500 dark:text-slate-400"
                                >
                                  {formatMessageTime(message.eventTimestamp)}
                                </time>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getMessageTypeClass(
                                    message.messageType
                                  )}`}
                                >
                                  {message.messageType}
                                </span>
                                {message.deliveryMode === 'backfill' ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                    backfill
                                  </span>
                                ) : null}
                              </div>
                              <MessageBody message={message} />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              {log.messageCursor !== undefined ? (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(): void => {
                      void log.loadMoreMessages();
                    }}
                    isLoading={log.loadingMoreMessages}
                    loadingText="Loading"
                  >
                    Load more messages
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
