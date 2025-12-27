import { useEffect, useState, useCallback } from 'react';
import { Layout, Card, Button, ImageModal, ImageThumbnail, AudioPlayer } from '@/components';
import { useAuth } from '@/context';
import {
  getWhatsAppMessages,
  deleteWhatsAppMessage,
  getMessageMediaUrl,
  ApiError,
} from '@/services';
import type { WhatsAppMessage } from '@/types';
import {
  Trash2,
  MessageSquare,
  RefreshCw,
  Image,
  Mic,
  Copy,
  Check,
  ExternalLink,
  X,
} from 'lucide-react';

const TEXT_PREVIEW_LIMIT = 800;

/**
 * URL regex pattern for detecting links in text.
 */
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;

/**
 * Renders text with clickable links.
 */
function TextWithLinks({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(URL_REGEX);

  return (
    <>
      {parts.map((part, index) => {
        if (URL_REGEX.test(part)) {
          // Reset regex lastIndex after test
          URL_REGEX.lastIndex = 0;
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
              onClick={(e): void => {
                e.stopPropagation();
              }}
            >
              {part}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

interface MessageItemProps {
  message: WhatsAppMessage;
  accessToken: string;
  onDelete: (id: string) => void;
  onImageClick: (messageId: string) => void;
  onNoteClick: (message: WhatsAppMessage) => void;
  isDeleting: boolean;
}

/**
 * Modal to display full note content (and optional image).
 */
interface NoteDetailModalProps {
  message: WhatsAppMessage;
  accessToken: string;
  onClose: () => void;
}

function NoteDetailModal({
  message,
  onClose,
}: Omit<NoteDetailModalProps, 'accessToken'>): React.JSX.Element {
  const [copied, setCopied] = useState(false);

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

  const textToCopy = message.caption ?? message.text;
  const hasTextContent = textToCopy !== '';

  const handleCopy = async (): Promise<void> => {
    if (!hasTextContent) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard API failed, ignore
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return (): void => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={handleBackdropClick}
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">
            {formattedDate} • {formattedTime}
          </div>
          <div className="flex items-center gap-2">
            {hasTextContent && (
              <button
                onClick={(): void => {
                  void handleCopy();
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  copied
                    ? 'bg-green-50 text-green-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                aria-label={copied ? 'Copied!' : 'Copy text'}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Text content */}
          {message.text !== '' && (
            <p className="whitespace-pre-wrap break-words text-slate-800">
              <TextWithLinks text={message.text} />
            </p>
          )}

          {/* Caption for media */}
          {message.caption !== null &&
            message.caption !== '' &&
            message.caption !== message.text && (
              <p className="mt-3 whitespace-pre-wrap break-words text-slate-600 italic">
                <TextWithLinks text={message.caption} />
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

function MessageItem({
  message,
  accessToken,
  onDelete,
  onImageClick,
  onNoteClick,
  isDeleting,
}: MessageItemProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const handleCopy = async (): Promise<void> => {
    const textToCopy = message.caption ?? message.text;
    if (textToCopy === '') return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard API failed, ignore
    }
  };

  const handleDeleteClick = (): void => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = (): void => {
    setShowDeleteConfirm(false);
    onDelete(message.id);
  };

  const handleDeleteCancel = (): void => {
    setShowDeleteConfirm(false);
  };

  const handleOpenFullSize = async (messageId: string): Promise<void> => {
    try {
      const response = await getMessageMediaUrl(accessToken, messageId);
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch {
      // Failed to get URL, ignore
    }
  };

  const hasTextContent =
    message.text !== '' || (message.caption !== null && message.caption !== '');

  return (
    <div
      className={`group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 ${
        isDeleting ? 'scale-95 opacity-50' : 'hover:border-slate-300 hover:shadow-md'
      }`}
    >
      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="mb-2 text-sm text-red-700">Are you sure you want to delete this message?</p>
          <div className="flex gap-2">
            <button
              onClick={handleDeleteConfirm}
              className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={handleDeleteCancel}
              className="rounded bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Media type indicator - only show for actual image/audio messages */}
          {(message.mediaType === 'image' || message.mediaType === 'audio') && (
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

              {/* Transcription status/content */}
              {message.transcriptionStatus === 'pending' ||
              message.transcriptionStatus === 'processing' ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                  <span>Transcription in progress...</span>
                </div>
              ) : message.transcriptionStatus === 'completed' &&
                message.transcription !== undefined &&
                message.transcription !== '' ? (
                <div className="mt-2 rounded-md bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500 mb-1">Transcription:</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    <TextWithLinks text={message.transcription} />
                  </p>
                </div>
              ) : message.transcriptionStatus === 'failed' ? (
                <div className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-600">
                  <p className="font-medium">Transcription failed</p>
                  {message.transcriptionError !== undefined && (
                    <div className="mt-1 text-xs text-red-500">
                      <p>
                        <span className="font-medium">Code:</span>{' '}
                        {message.transcriptionError.code}
                      </p>
                      <p>
                        <span className="font-medium">Details:</span>{' '}
                        {message.transcriptionError.message}
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Text content with clickable links */}
          {message.text !== '' && (
            <div
              onClick={(): void => {
                onNoteClick(message);
              }}
              className={
                message.mediaType !== 'audio'
                  ? 'cursor-pointer hover:bg-slate-50 -mx-2 px-2 py-1 rounded transition-colors'
                  : ''
              }
            >
              <p className="whitespace-pre-wrap break-words text-slate-800">
                {message.text.length > TEXT_PREVIEW_LIMIT ? (
                  <>
                    <TextWithLinks text={message.text.slice(0, TEXT_PREVIEW_LIMIT)} />
                    <span className="text-slate-400">...</span>
                    <span className="ml-1 text-sm text-blue-600 hover:underline">show more</span>
                  </>
                ) : (
                  <TextWithLinks text={message.text} />
                )}
              </p>
            </div>
          )}

          {/* Caption for media with clickable links - only show if different from text */}
          {message.caption !== null &&
            message.caption !== '' &&
            message.caption !== message.text && (
              <div
                onClick={(): void => {
                  onNoteClick(message);
                }}
                className="cursor-pointer hover:bg-slate-50 -mx-2 px-2 py-1 rounded transition-colors"
              >
                <p className="mt-2 whitespace-pre-wrap break-words text-slate-600 italic">
                  {message.caption.length > TEXT_PREVIEW_LIMIT ? (
                    <>
                      <TextWithLinks text={message.caption.slice(0, TEXT_PREVIEW_LIMIT)} />
                      <span className="text-slate-400">...</span>
                      <span className="ml-1 text-sm text-blue-600 hover:underline">show more</span>
                    </>
                  ) : (
                    <TextWithLinks text={message.caption} />
                  )}
                </p>
              </div>
            )}

          <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <span>{formattedDate}</span>
            <span>•</span>
            <span>{formattedTime}</span>
            {message.mediaType === 'image' && message.hasMedia && (
              <>
                <span>•</span>
                <button
                  onClick={(): void => {
                    void handleOpenFullSize(message.id);
                  }}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                  title="Open full size in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Full size</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 gap-1">
          {/* Copy button */}
          {hasTextContent && (
            <button
              onClick={(): void => {
                void handleCopy();
              }}
              className={`rounded-lg p-2 transition-all ${
                copied
                  ? 'bg-green-50 text-green-600'
                  : 'text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 group-hover:opacity-100'
              }`}
              aria-label={copied ? 'Copied!' : 'Copy message'}
              title={copied ? 'Copied!' : 'Copy message'}
            >
              {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            </button>
          )}

          {/* Delete button */}
          <button
            onClick={handleDeleteClick}
            disabled={isDeleting || showDeleteConfirm}
            className="rounded-lg p-2 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Delete message"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
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
  const [selectedNote, setSelectedNote] = useState<WhatsAppMessage | null>(null);
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
              onNoteClick={(msg): void => {
                setSelectedNote(msg);
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

      {/* Note detail modal */}
      {selectedNote !== null && (
        <NoteDetailModal
          message={selectedNote}
          onClose={(): void => {
            setSelectedNote(null);
          }}
        />
      )}
    </Layout>
  );
}
