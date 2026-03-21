import { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { formatDateTime } from '@/utils/dateFormat';
import type { WhatsAppMessage } from '@/types';

import { TextWithLinks } from './shared.js';

interface NoteDetailModalProps {
  message: WhatsAppMessage;
  onClose: () => void;
}

export function NoteDetailModal({
  message,
  onClose,
}: NoteDetailModalProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

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
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl dark:bg-slate-800">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {formatDateTime(message.receivedAt)}
          </div>
          <div className="flex items-center gap-2">
            {hasTextContent && (
              <button
                onClick={(): void => {
                  void handleCopy();
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  copied
                    ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
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
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
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
            <p className="whitespace-pre-wrap break-word text-slate-800 dark:text-slate-200">
              <TextWithLinks text={message.text} />
            </p>
          )}

          {/* Caption for media */}
          {message.caption !== null &&
            message.caption !== '' &&
            message.caption !== message.text && (
              <p className="mt-3 whitespace-pre-wrap break-word text-slate-600 italic dark:text-slate-400">
                <TextWithLinks text={message.caption} />
              </p>
            )}
        </div>
      </div>
    </div>
  );
}
