import { useEffect, useState, useCallback } from 'react';
import { Layout, Card, Button, ImageModal, ImageThumbnail, AudioPlayer } from '@/components';
import { useAuth } from '@/context';
import { getWhatsAppMessages, deleteWhatsAppMessage, ApiError } from '@/services';
import type { WhatsAppMessage } from '@/types';
import { Trash2, MessageSquare, RefreshCw, Image, Mic } from 'lucide-react';

interface MessageItemProps {
  message: WhatsAppMessage;
  accessToken: string;
  onDelete: (id: string) => void;
  onImageClick: (messageId: string) => void;
  isDeleting: boolean;
}

function MessageItem({
  message,
  accessToken,
  onDelete,
  onImageClick,
  isDeleting,
}: MessageItemProps): React.JSX.Element {
  const receivedDate = new Date(message.receivedAt);
  const formattedDate = receivedDate.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const formattedTime = receivedDate.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 ${
        isDeleting ? 'scale-95 opacity-50' : 'hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Media type indicator */}
          {message.mediaType !== 'text' && (
            <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
              {message.mediaType === 'image' ? (
                <>
                  <Image className="h-3.5 w-3.5" />
                  <span>Image</span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  <span>Audio</span>
                </>
              )}
            </div>
          )}

          {/* Image thumbnail */}
          {message.mediaType === 'image' && message.hasMedia && (
            <div className="mb-3">
              <ImageThumbnail
                messageId={message.id}
                accessToken={accessToken}
                onClick={(): void => {
                  onImageClick(message.id);
                }}
              />
            </div>
          )}

          {/* Audio player */}
          {message.mediaType === 'audio' && message.hasMedia && (
            <div className="mb-3">
              <AudioPlayer messageId={message.id} accessToken={accessToken} />
            </div>
          )}

          {/* Text content */}
          {message.text !== '' && (
            <p className="whitespace-pre-wrap break-words text-slate-800">{message.text}</p>
          )}

          {/* Caption for media */}
          {message.caption !== null && message.caption !== '' && (
            <p className="mt-2 whitespace-pre-wrap break-words text-slate-600 italic">
              {message.caption}
            </p>
          )}

          <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <span>{formattedDate}</span>
            <span>•</span>
            <span>{formattedTime}</span>
          </div>
        </div>
        <button
          onClick={(): void => {
            onDelete(message.id);
          }}
          disabled={isDeleting}
          className="shrink-0 rounded-lg p-2 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Delete message"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function WhatsAppNotesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [currentAccessToken, setCurrentAccessToken] = useState<string | null>(null);

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
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to fetch messages');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [getAccessToken]
  );

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">WhatsApp Notes</h2>
          {fromNumber !== null && fromNumber !== '' ? (
            <p className="text-slate-600">
              Messages from{' '}
              <span className="font-mono font-medium text-slate-800">{fromNumber}</span>
            </p>
          ) : (
            <p className="text-slate-600">Your saved WhatsApp messages</p>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={handleRefresh}
          isLoading={isRefreshing}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        {messages.length === 0 ? (
          <Card title="">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="mb-4 h-12 w-12 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-700">No messages yet</h3>
              <p className="mt-1 text-sm text-slate-500">
                Messages you send to your WhatsApp number will appear here.
              </p>
            </div>
          </Card>
        ) : (
          messages.map((message) => (
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
              isDeleting={deletingIds.has(message.id)}
            />
          ))
        )}
      </div>

      {messages.length > 0 ? (
        <p className="mt-6 text-center text-sm text-slate-500">
          Showing {String(messages.length)} message{messages.length === 1 ? '' : 's'}
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
    </Layout>
  );
}
