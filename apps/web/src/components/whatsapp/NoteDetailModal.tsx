import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { formatDateTime } from '@/utils/dateFormat';
import type { WhatsAppMessage } from '@/types';
import { Modal } from '@/components/ui/Modal';

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

  return (
    <Modal
      open
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title="Note Details"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-2xl dark:bg-slate-800"
    >
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
    </Modal>
  );
}
