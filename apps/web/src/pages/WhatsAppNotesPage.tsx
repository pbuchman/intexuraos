import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, MessageSquare, RefreshCw } from 'lucide-react';
import { Button, Card, ErrorBanner, ImageModal, Layout } from '@/components';
import { useAuth } from '@/context';
import {
  ApiError,
  deleteWhatsAppMessage,
  getWhatsAppMessages,
} from '@/services';
import type { WhatsAppMessage } from '@/types';

import {
  MessageItem,
} from '@/components/whatsapp/MessageItem.js';
import {
  NoteDetailModal,
} from '@/components/whatsapp/NoteDetailModal.js';
import {
  TranscriptionDetailModal,
} from '@/components/whatsapp/TranscriptionDetailModal.js';
import {
  WHATSAPP_MEDIA_FILTER_CONFIG,
  WHATSAPP_MEDIA_TYPES,
  WHATSAPP_SORT_OPTIONS,
  type WhatsAppMediaType,
  type WhatsAppSortOption,
} from '@/components/whatsapp/shared.js';

const INACTIVE_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

export function WhatsAppNotesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<WhatsAppMessage | null>(null);
  const [selectedTranscription, setSelectedTranscription] = useState<WhatsAppMessage | null>(null);
  const [currentAccessToken, setCurrentAccessToken] = useState<string | null>(null);

  // Filter state
  const [mediaFilter, setMediaFilter] = useState<WhatsAppMediaType>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('whatsapp-media-filter');
      if (stored && WHATSAPP_MEDIA_TYPES.includes(stored as WhatsAppMediaType)) {
        return stored as WhatsAppMediaType;
      }
    }
    return 'all';
  });

  // Sort state
  const [sort, setSort] = useState<WhatsAppSortOption>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('whatsapp-sort');
      if (stored && WHATSAPP_SORT_OPTIONS.some((o) => o.key === stored)) {
        return stored as WhatsAppSortOption;
      }
    }
    return 'newest';
  });

  // Persist filter selection
  useEffect(() => {
    localStorage.setItem('whatsapp-media-filter', mediaFilter);
  }, [mediaFilter]);

  // Persist sort selection
  useEffect(() => {
    localStorage.setItem('whatsapp-sort', sort);
  }, [sort]);

  const fetchMessages = useCallback(
    async (showRefreshing?: boolean): Promise<void> => {
      try {
        if (showRefreshing === true) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);

        const token = await getAccessToken();
        setCurrentAccessToken(token);
        const response = await getWhatsAppMessages(token);

        setMessages(response.messages);
        setFromNumber(response.fromNumber);
        setNextCursor(response.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to fetch messages');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [getAccessToken]
  );

  const loadMore = async (): Promise<void> => {
    if (nextCursor === undefined || isLoadingMore) return;

    try {
      setIsLoadingMore(true);
      const token = await getAccessToken();
      const response = await getWhatsAppMessages(token, { cursor: nextCursor });

      setMessages((prev) => [...prev, ...response.messages]);
      setNextCursor(response.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load more messages');
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  const handleDelete = async (messageId: string): Promise<void> => {
    setDeletingIds((prev) => new Set(prev).add(messageId));

    try {
      const token = await getAccessToken();
      await deleteWhatsAppMessage(token, messageId);

      // Animate out then remove
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }, 300);
    } catch (e) {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
      setError(e instanceof ApiError ? e.message : 'Failed to delete message');
    }
  };

  const handleRefresh = (): void => {
    void fetchMessages(true);
  };

  const toggleMediaFilter = (filter: WhatsAppMediaType): void => {
    setMediaFilter(filter);
  };

  // Compute filtered and sorted messages
  const filteredMessages = useMemo(() => {
    let result = [...messages];

    // Filter by media type
    if (mediaFilter !== 'all') {
      result = result.filter((m) => m.mediaType === mediaFilter);
    }

    // Sort with safe date parsing
    result.sort((a, b) => {
      const dateA = new Date(a.receivedAt).getTime();
      const dateB = new Date(b.receivedAt).getTime();
      // Handle NaN by placing invalid dates at the end
      if (Number.isNaN(dateA) && Number.isNaN(dateB)) return 0;
      if (Number.isNaN(dateA)) return 1;
      if (Number.isNaN(dateB)) return -1;
      if (sort === 'newest') {
        return dateB - dateA;
      } else {
        return dateA - dateB;
      }
    });

    return result;
  }, [messages, mediaFilter, sort]);

  // Compute counts for filter pills
  const mediaCounts = useMemo(() => {
    const counts: Record<WhatsAppMediaType, number> = {
      all: messages.length,
      text: 0,
      image: 0,
      audio: 0,
    };
    for (const msg of messages) {
      if (msg.mediaType === 'text') counts.text++;
      else if (msg.mediaType === 'image') counts.image++;
      else counts.audio++;
    }
    return counts;
  }, [messages]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">WhatsApp Notes</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {filteredMessages.length} message{filteredMessages.length === 1 ? '' : 's'}
            {fromNumber !== null && fromNumber !== '' && (
              <>
                {' '}from{' '}
                <span className="font-mono font-medium text-slate-700 dark:text-slate-200">
                  {fromNumber}
                </span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error banner */}
      <ErrorBanner message={error} className="mb-6" />

      {/* Media type filter pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {WHATSAPP_MEDIA_TYPES.map((mediaType) => {
          const config = WHATSAPP_MEDIA_FILTER_CONFIG[mediaType];
          const isActive = mediaFilter === mediaType;
          const count = mediaCounts[mediaType];

          return (
            <button
              key={mediaType}
              onClick={(): void => {
                toggleMediaFilter(mediaType);
              }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive ? config.activeClass : INACTIVE_CLASS
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
              {config.label}
              <span className="font-medium">{String(count)}</span>
            </button>
          );
        })}
      </div>

      {/* Sort selector */}
      <div className="mb-4 flex items-center gap-2">
        <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">
          Sort
        </span>
        <div className="flex gap-1.5">
          {WHATSAPP_SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={(): void => {
                setSort(key);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                sort === key
                  ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Messages list */}
      <div className="space-y-1">
        {filteredMessages.length === 0 ? (
          <Card title="">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
              <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200">No messages yet</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Messages you send to your WhatsApp number will appear here.
              </p>
            </div>
          </Card>
        ) : (
          filteredMessages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              accessToken={currentAccessToken ?? ''}
              onDelete={(id): void => {
                void handleDelete(id);
              }}
              onImageClick={(id): void => {
                setSelectedImageId(id);
              }}
              onNoteClick={(msg): void => {
                setSelectedNote(msg);
              }}
              onTranscriptionClick={(msg): void => {
                setSelectedTranscription(msg);
              }}
              isDeleting={deletingIds.has(message.id)}
            />
          ))
        )}
      </div>

      {/* Load more button */}
      {nextCursor !== undefined ? (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            onClick={(): void => {
              void loadMore();
            }}
            isLoading={isLoadingMore}
          >
            Load More
          </Button>
        </div>
      ) : null}

      {messages.length > 0 ? (
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Showing {String(filteredMessages.length)} of {String(messages.length)} message
          {messages.length === 1 ? '' : 's'}
        </p>
      ) : null}

      {/* Image modal */}
      {selectedImageId !== null && currentAccessToken !== null && (
        <ImageModal
          messageId={selectedImageId}
          accessToken={currentAccessToken}
          onClose={(): void => {
            setSelectedImageId(null);
          }}
        />
      )}

      {/* Note detail modal */}
      {selectedNote !== null && (
        <NoteDetailModal
          message={selectedNote}
          onClose={(): void => {
            setSelectedNote(null);
          }}
        />
      )}

      {/* Transcription detail modal */}
      {selectedTranscription !== null && (
        <TranscriptionDetailModal
          message={selectedTranscription}
          onClose={(): void => {
            setSelectedTranscription(null);
          }}
        />
      )}
    </Layout>
  );
}
