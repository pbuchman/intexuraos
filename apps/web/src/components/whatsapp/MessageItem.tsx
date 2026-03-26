import { useState } from 'react';
import { AudioPlayer, ImageThumbnail } from '@/components';
import { getMessageMediaUrl } from '@/services';
import { formatDateTime, formatDateTimeCompact } from '@/utils/dateFormat';
import type { WhatsAppMessage } from '@/types';
import {
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Trash2,
} from 'lucide-react';

import { TextWithLinks } from './shared.js';

const TEXT_PREVIEW_LIMIT = 800;

// Extracted helpers to avoid recomputation on every render
function getDesktopMediaIndicator(
  message: WhatsAppMessage,
  accessToken: string,
  onImageClick: (messageId: string) => void,
): React.JSX.Element {
  if (message.mediaType === 'image' && message.hasMedia) {
    return (
      <ImageThumbnail
        messageId={message.id}
        accessToken={accessToken}
        onClick={(): void => {
          onImageClick(message.id);
        }}
      />
    );
  }
  if (message.mediaType === 'audio') {
    return <Mic className="h-4 w-4 text-slate-400" />;
  }
  return <MessageSquare className="h-4 w-4 text-slate-400" />;
}

function getMobileMediaIndicator(message: WhatsAppMessage): React.JSX.Element {
  if (message.mediaType === 'image' && message.hasMedia) {
    return <ImageIcon className="h-4 w-4 text-slate-400" />;
  }
  if (message.mediaType === 'audio') {
    return <Mic className="h-4 w-4 text-slate-400" />;
  }
  return <MessageSquare className="h-4 w-4 text-slate-400" />;
}

function getContentPreviewForMessage(message: WhatsAppMessage): string {
  if (message.mediaType === 'image' && message.caption) {
    return message.caption;
  }
  if (message.mediaType === 'audio' && message.transcription) {
    return message.transcription;
  }
  if (message.text) {
    return message.text;
  }
  if (message.caption) {
    return message.caption;
  }
  return '';
}

interface MessageItemProps {
  message: WhatsAppMessage;
  accessToken: string;
  onDelete: (id: string) => void;
  onImageClick: (messageId: string) => void;
  onNoteClick: (message: WhatsAppMessage) => void;
  onTranscriptionClick: (message: WhatsAppMessage) => void;
  isDeleting: boolean;
}

export function MessageItem({
  message,
  accessToken,
  onDelete,
  onImageClick,
  onNoteClick,
  onTranscriptionClick,
  isDeleting,
}: MessageItemProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copiedTranscription, setCopiedTranscription] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fullSizeError, setFullSizeError] = useState(false);

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

  const handleCopyTranscription = async (): Promise<void> => {
    if (message.transcription === undefined || message.transcription === '') return;

    try {
      await navigator.clipboard.writeText(message.transcription);
      setCopiedTranscription(true);
      setTimeout(() => {
        setCopiedTranscription(false);
      }, 2000);
    } catch {
      // Clipboard API failed, ignore
    }
  };

  const handleOpenFullSize = async (messageId: string): Promise<void> => {
    setFullSizeError(false);
    try {
      const response = await getMessageMediaUrl(accessToken, messageId);
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch {
      setFullSizeError(true);
      setTimeout(() => {
        setFullSizeError(false);
      }, 3000);
    }
  };

  const hasTextContent =
    message.text !== '' || (message.caption !== null && message.caption !== '');

  const contentPreview = getContentPreviewForMessage(message);
  const truncatedPreview =
    contentPreview.length > TEXT_PREVIEW_LIMIT
      ? contentPreview.slice(0, TEXT_PREVIEW_LIMIT) + '...'
      : contentPreview;

  const renderPreviewStatus = (variant: 'mobile' | 'desktop'): React.JSX.Element | null => {
    const statusBaseClass = variant === 'mobile' ? 'mt-1 text-xs' : 'truncate text-xs';

    if (
      message.mediaType === 'audio' &&
      message.transcriptionStatus !== 'completed' &&
      message.transcriptionStatus !== 'failed'
    ) {
      return (
        <p className={`${statusBaseClass} text-slate-500 dark:text-slate-400`}>
          Transcribing...
        </p>
      );
    }

    if (message.mediaType === 'audio' && message.transcriptionStatus === 'failed') {
      return (
        <p className={`${statusBaseClass} text-red-500 dark:text-red-400`}>
          Transcription failed
        </p>
      );
    }

    return null;
  };

  const renderActionButtons = (variant: 'mobile' | 'desktop'): React.JSX.Element => {
    const desktopRevealClass = variant === 'desktop' ? 'sm:opacity-0 sm:group-hover:opacity-100' : '';
    const noteActionClass = `rounded p-1 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 ${desktopRevealClass}`;
    const deleteActionClass = `rounded p-1 text-slate-400 transition-all hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 ${desktopRevealClass}`;
    const copyActionClass = copied
      ? 'rounded p-1 transition-all text-green-600 dark:text-green-400'
      : `rounded p-1 transition-all text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 ${desktopRevealClass}`;

    return (
      <div className="flex items-center justify-end gap-1">
        {message.mediaType === 'audio' ? (
          message.transcriptionStatus === 'completed' &&
          message.transcription !== undefined &&
          message.transcription !== '' ? (
            <button
              onClick={(e): void => {
                e.stopPropagation();
                onTranscriptionClick(message);
              }}
              className={noteActionClass}
              aria-label="View transcription"
              title="View transcription"
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
          ) : null
        ) : (
          <button
            onClick={(e): void => {
              e.stopPropagation();
              onNoteClick(message);
            }}
            className={noteActionClass}
            aria-label="View note"
            title="View note"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        )}

        {hasTextContent && (
          <button
            onClick={(e): void => {
              e.stopPropagation();
              void handleCopy();
            }}
            className={copyActionClass}
            aria-label={copied ? 'Copied!' : 'Copy message'}
            title={copied ? 'Copied!' : 'Copy message'}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}

        <button
          onClick={(e): void => {
            e.stopPropagation();
            setShowDeleteConfirm(true);
          }}
          disabled={isDeleting || showDeleteConfirm}
          className={deleteActionClass}
          aria-label="Delete"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div
      className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${
        isDeleting ? 'scale-95 opacity-50' : ''
      }`}
      onClick={(): void => {
        if (message.mediaType === 'audio') {
          // Audio rows don't open note modal on row click
          return;
        }
        onNoteClick(message);
      }}
    >
      <div data-testid="message-item-mobile" className="sm:hidden">
        <div className="min-w-0">
          <p className="line-clamp-2 break-words font-medium text-slate-900 dark:text-slate-100">
            {truncatedPreview}
          </p>
          {renderPreviewStatus('mobile')}
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
              {getMobileMediaIndicator(message)}
            </div>
            <span>{formatDateTimeCompact(message.receivedAt)}</span>
          </div>
          <div className="shrink-0">{renderActionButtons('mobile')}</div>
        </div>
      </div>

      <div
        data-testid="message-item-desktop"
        className="hidden sm:grid sm:grid-cols-[auto_1fr_140px_100px] sm:items-center sm:gap-2"
      >
        <div className="flex h-8 w-8 items-center justify-center">
          {getDesktopMediaIndicator(message, accessToken, onImageClick)}
        </div>

        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">
            {truncatedPreview}
          </p>
          {renderPreviewStatus('desktop')}
        </div>

        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatDateTime(message.receivedAt)}
        </span>

        {renderActionButtons('desktop')}
      </div>

      {/* Overlay delete confirmation */}
      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
            <button
              onClick={(): void => {
                setShowDeleteConfirm(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={(): void => {
                setShowDeleteConfirm(false);
                onDelete(message.id);
              }}
              disabled={isDeleting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}

      {/* Expanded content for audio messages (transcription) */}
      {message.mediaType === 'audio' &&
        message.transcriptionStatus === 'completed' &&
        message.transcription !== undefined &&
        message.transcription !== '' && (
          <div className="mt-3 rounded-md bg-slate-50 p-3 dark:bg-slate-700">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Transcription:</p>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  void handleCopyTranscription();
                }}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-all ${
                  copiedTranscription
                    ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-300 dark:hover:bg-slate-500'
                }`}
                aria-label={copiedTranscription ? 'Copied!' : 'Copy transcription'}
              >
                {copiedTranscription ? (
                  <>
                    <Check className="h-3 w-3" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div
              onClick={(): void => {
                onTranscriptionClick(message);
              }}
              className="cursor-pointer rounded px-1 py-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-600"
            >
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                <TextWithLinks text={message.transcription} />
              </p>
              {message.transcription.length > TEXT_PREVIEW_LIMIT && (
                <span className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                  show more
                </span>
              )}
            </div>
          </div>
        )}

      {/* Audio player for audio messages */}
      {message.mediaType === 'audio' && message.hasMedia && (
        <div className="mt-3">
          <AudioPlayer messageId={message.id} accessToken={accessToken} />

          {/* Transcription status */}
          {message.transcriptionStatus === 'pending' ||
          message.transcriptionStatus === 'processing' ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500 [animation-delay:0ms]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500 [animation-delay:150ms]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500 [animation-delay:300ms]" />
              </div>
              <span className="text-xs text-slate-400 dark:text-slate-500">Transcribing...</span>
            </div>
          ) : message.transcriptionStatus === 'failed' ? (
            <div className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
              <p className="font-medium">Transcription failed</p>
              {message.transcriptionError?.message !== undefined && (
                <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                  {message.transcriptionError.message}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Image full size link */}
      {message.mediaType === 'image' && message.hasMedia && (
        <div className="mt-2 flex flex-col gap-1 text-sm">
          <button
            onClick={(e): void => {
              e.stopPropagation();
              void handleOpenFullSize(message.id);
            }}
            className="flex w-fit items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
            title="Open full size in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Full size</span>
          </button>
          {fullSizeError && (
            <span className="text-xs text-red-500 dark:text-red-400">
              Failed to open image
            </span>
          )}
        </div>
      )}
    </div>
  );
}
