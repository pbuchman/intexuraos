import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquarePlus, Send, Sparkles } from 'lucide-react';
import { Button, Card, MarkdownContent } from '@/components';
import { formatDateTime, formatRelative } from '@/utils/dateFormat';
import type {
  FishingChat,
  FishingChatMessage,
  SendFishingChatMessageResponse,
} from '@/types/fishingAssistant';

interface FishingChatPanelProps {
  readonly chats: readonly FishingChat[];
  readonly selectedChatId: string | undefined;
  readonly messages: readonly FishingChatMessage[];
  readonly loading: boolean;
  readonly sending: boolean;
  readonly error: string | null;
  readonly errorCode: string | null;
  readonly selectedMessageId: string | null | undefined;
  readonly onSelectChat: (chatId: string) => void;
  readonly onCreateChat: () => Promise<void>;
  readonly onSendMessage: (text: string) => Promise<SendFishingChatMessageResponse | null>;
  readonly onSelectMessage?: (messageId: string) => void;
}

function assistantTone(confidence?: FishingChatMessage['confidence']): string {
  switch (confidence) {
    case 'high':
      return 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30';
    case 'medium':
      return 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30';
    case 'low':
    case undefined:
      return 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30';
  }
}

export function FishingChatPanel({
  chats,
  selectedChatId,
  messages,
  loading,
  sending,
  error,
  errorCode,
  selectedMessageId,
  onSelectChat,
  onCreateChat,
  onSendMessage,
  onSelectMessage,
}: FishingChatPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('');

  const submitDraft = async (nextDraft: string = draft): Promise<void> => {
    const trimmed = nextDraft.trim();
    if (trimmed === '') {
      return;
    }
    const result = await onSendMessage(trimmed);
    if (result !== null) {
      setDraft('');
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submitDraft();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-full">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Chats</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Persisted fishing sessions
            </p>
          </div>
          <Button size="sm" onClick={(): void => { void onCreateChat(); }}>
            <MessageSquarePlus className="mr-1 h-4 w-4" />
            New Chat
          </Button>
        </div>

        <div className="space-y-2">
          {chats.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
              No chats yet.
            </div>
          ) : (
            chats.map((chat) => {
              const isActive = chat.id === selectedChatId;
              return (
                <button
                  key={chat.id}
                  type="button"
                  onClick={(): void => { onSelectChat(chat.id); }}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    isActive
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {chat.title}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatRelative(chat.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                    {chat.lastMessagePreview === '' ? 'No assistant answer yet.' : chat.lastMessagePreview}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </Card>

      <Card className="flex min-h-[620px] flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Fishing Assistant
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ask about tactics, bait, and recent group findings.
            </p>
          </div>
          {loading ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          ) : null}
        </div>

        {error !== null ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            <p>{error}</p>
            {errorCode === 'NO_API_KEY' ? (
              <Link
                to="/settings/api-keys"
                className="mt-2 inline-flex font-medium text-red-700 underline dark:text-red-300"
              >
                Add OpenRouter key
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center dark:border-slate-600 dark:bg-slate-900/30">
              <Sparkles className="mb-3 h-8 w-8 text-blue-500" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Start a chat and the assistant will answer from your knowledge base and digest evidence.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const isAssistant = message.role === 'assistant';
              const isSelected = selectedMessageId === message.id;
              const wrapperClass = isAssistant
                ? `${assistantTone(message.confidence)} ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-800' : ''}`
                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40';
              const content = (
                <div
                  className={`max-w-[90%] rounded-2xl border px-4 py-3 text-sm ${
                    isAssistant ? wrapperClass : wrapperClass
                  } ${message.role === 'user' ? 'ml-auto' : ''}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold uppercase tracking-wide">
                      {message.role === 'assistant' ? 'Assistant' : 'You'}
                    </span>
                    <span title={formatDateTime(message.createdAt)}>
                      {formatRelative(message.createdAt)}
                    </span>
                  </div>
                  {isAssistant ? (
                    <div className="text-slate-800 dark:text-slate-200">
                      <MarkdownContent content={message.content} />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                      {message.content}
                    </p>
                  )}
                  {isAssistant && message.citations.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {message.citations.map((citation, index) => {
                        const label = `[${String(index + 1)}]`;
                        if (citation.url === undefined || citation.url === '') {
                          return (
                            <span
                              key={`${message.id}-${citation.sourceId}-${String(index)}`}
                              className="font-semibold text-slate-500 dark:text-slate-400"
                            >
                              {label}
                            </span>
                          );
                        }

                        if (citation.url.startsWith('/')) {
                          return (
                            <Link
                              key={`${message.id}-${citation.sourceId}-${String(index)}`}
                              to={citation.url}
                              className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {label}
                            </Link>
                          );
                        }

                        return (
                          <a
                            key={`${message.id}-${citation.sourceId}-${String(index)}`}
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {label}
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                  {message.citations.length > 0 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {String(message.citations.length)} reference{message.citations.length === 1 ? '' : 's'}
                    </p>
                  ) : null}
                </div>
              );

              return isAssistant && onSelectMessage !== undefined ? (
                <button
                  key={message.id}
                  type="button"
                  onClick={(): void => { onSelectMessage(message.id); }}
                  className="flex w-full justify-start text-left"
                >
                  {content}
                </button>
              ) : (
                <div key={message.id} className="flex w-full justify-start">
                  {content}
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={(event): void => { void handleSubmit(event); }} className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
          <label
            htmlFor="fishing-assistant-chat-input"
            className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Ask Fishing Assistant
          </label>
          <textarea
            id="fishing-assistant-chat-input"
            value={draft}
            onChange={(event): void => { setDraft(event.target.value); }}
            onKeyDown={(event): void => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }
              event.preventDefault();
              void submitDraft(event.currentTarget.value);
            }}
            placeholder="What changed in the last few days for feeder fishing?"
            rows={4}
            disabled={sending}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="mt-3 flex justify-end">
            <Button type="submit" isLoading={sending} loadingText="Sending...">
              <Send className="mr-2 h-4 w-4" />
              Send
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
