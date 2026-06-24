import { useMemo } from 'react';
import {
  CalendarDays,
  FileText,
  Image,
  MessageSquare,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import { Button, ErrorBanner, Layout } from '@/components';
import { usePrivateWhatsAppLog } from '@/hooks/usePrivateWhatsAppLog';
import { formatDateTimeCompact, formatRelative } from '@/utils/dateFormat';
import type {
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageType,
  PrivateWhatsAppSender,
} from '@/types';

function getSenderLabel(sender: PrivateWhatsAppSender | undefined, fallback?: string): string {
  return (
    sender?.senderDisplayName ??
    sender?.senderPhoneNumber ??
    fallback ??
    sender?.senderKey ??
    'Unknown sender'
  );
}

function getSenderMeta(sender: PrivateWhatsAppSender): string {
  if (sender.senderDisplayName !== undefined && sender.senderPhoneNumber !== undefined) {
    return sender.senderPhoneNumber;
  }
  if (sender.senderPhoneNumberNormalized !== undefined) {
    return sender.senderPhoneNumberNormalized;
  }
  return sender.senderKey;
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

function MessageBody({ message }: { message: PrivateWhatsAppMessage }): React.JSX.Element {
  if (message.text !== undefined && message.text.trim() !== '') {
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900 dark:text-slate-100">
        {message.text}
      </p>
    );
  }

  const mediaName = message.media?.fileName ?? message.media?.mimeType ?? `${message.messageType} message`;
  const Icon = message.messageType === 'image' ? Image : FileText;

  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{mediaName}</span>
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
  const selectedSenderLabel = getSenderLabel(log.selectedSender, log.selectedSenderKey);
  const groupedMessages = useMemo(() => groupMessagesByDay(log.messages), [log.messages]);
  const hasNoSenders = !log.loadingSenders && log.senders.length === 0;
  const hasNoMessages = !log.loadingMessages && log.selectedSenderKey !== undefined && log.messages.length === 0;

  return (
    <Layout>
      <div data-testid="private-whatsapp-log-shell" className="flex w-full min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">
              Private WhatsApp
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Read-only incoming message log grouped by sender and day.
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
            data-testid="private-whatsapp-sender-rail"
            className="flex max-h-[45vh] min-h-0 flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:max-h-[28rem] xl:max-h-none"
          >
            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
              <label className="sr-only" htmlFor="private-whatsapp-sender-search">
                Search senders
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  id="private-whatsapp-sender-search"
                  type="search"
                  value={log.senderSearch}
                  onChange={(event): void => {
                    log.setSenderSearch(event.target.value);
                  }}
                  placeholder="Search senders"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:bg-slate-900 dark:focus:ring-blue-900/40"
                />
              </div>
            </div>

            <div className="min-h-[14rem] flex-1 overflow-y-auto p-2">
              {log.loadingSenders ? (
                <div className="flex items-center justify-center py-10">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                </div>
              ) : null}

              {hasNoSenders ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    No private WhatsApp messages yet.
                  </p>
                </div>
              ) : null}

              {!log.loadingSenders && log.senders.length > 0 && log.filteredSenders.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  No senders match this search.
                </div>
              ) : null}

              <div className="space-y-1">
                {log.filteredSenders.map((sender) => {
                  const selected = sender.senderKey === log.selectedSenderKey;
                  return (
                    <button
                      key={sender.id}
                      type="button"
                      onClick={(): void => {
                        log.selectSender(sender.senderKey);
                      }}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        selected
                          ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
                          : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
                            {getSenderLabel(sender)}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                            {getSenderMeta(sender)}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {String(sender.messageCount)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {formatRelative(sender.lastEventAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {log.senderCursor !== undefined ? (
              <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={(): void => {
                    void log.loadMoreSenders();
                  }}
                  isLoading={log.loadingMoreSenders}
                  loadingText="Loading"
                >
                  Load more senders
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
                    <UserRound className="h-5 w-5 text-slate-400" />
                    <h3 className="truncate text-lg font-semibold text-slate-950 dark:text-slate-50">
                      {log.selectedSenderKey === undefined ? 'Select a sender' : selectedSenderLabel}
                    </h3>
                  </div>
                  {log.selectedSender !== undefined ? (
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {String(log.selectedSender.messageCount)} total messages · Last seen{' '}
                      {formatDateTimeCompact(log.selectedSender.lastEventAt)}
                    </p>
                  ) : null}
                </div>
              </div>

              {log.selectedSenderKey !== undefined ? (
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
                  {log.senderDays.map((day) => (
                    <button
                      key={day.id}
                      type="button"
                      onClick={(): void => {
                        log.selectDay(day.eventDayKey);
                      }}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        log.selectedDay === day.eventDayKey
                          ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span>{day.eventDayKey}</span>
                      <span className="text-xs text-slate-400">{String(day.messageCount)}</span>
                    </button>
                  ))}
                  {log.loadingSenderDays ? (
                    <span className="px-2 py-1.5 text-sm text-slate-400">Loading days...</span>
                  ) : null}
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
                    {log.selectedDay === undefined ? 'No messages for this sender.' : 'No messages for this day.'}
                  </p>
                </div>
              ) : null}

              {!log.loadingMessages && log.selectedSenderKey === undefined ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <UserRound className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Select a sender to read messages.
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
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                      {group.messages.map((message) => (
                        <article key={message.id} className="px-4 py-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
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
                        </article>
                      ))}
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
