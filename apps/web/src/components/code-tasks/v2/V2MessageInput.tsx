import { useCallback, useRef, useState } from 'react';
import { Loader2, Send, WifiOff } from 'lucide-react';
import type { MessageStatus } from '@/hooks';

interface V2MessageInputProps {
  onSendMessage: (message: string) => Promise<void>;
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: MessageStatus;
  workerOnline: boolean;
  workerName: string;
}

export function V2MessageInput({ onSendMessage, sending, sendError, messageStatus, workerOnline, workerName }: V2MessageInputProps): React.JSX.Element {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback((): void => {
    const trimmed = message.trim();
    if (trimmed.length === 0 || sending) return;
    setMessage('');
    if (textareaRef.current !== null) {
      textareaRef.current.style.height = '';
    }
    void onSendMessage(trimmed).finally(() => {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    });
  }, [message, sending, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setMessage(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, 96))}px`;
  }, []);

  const hasText = message.trim().length > 0;

  return (
    <div className="rounded-b-lg border-t border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      {!workerOnline ? (
        <div className="mb-2 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span>Worker may be offline — message will be delivered when the worker is back online</span>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Send a message to Claude..."
          rows={1}
          className="flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-slate-900 placeholder-slate-400 outline-none min-h-[2.25rem] max-h-24 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!hasText || sending}
          className={`rounded p-1.5 transition-colors ${
            hasText && !sending
              ? 'text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300'
              : 'text-slate-300 cursor-not-allowed dark:text-slate-600'
          }`}
          title="Send (Enter)"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>

      {messageStatus === 'delivered' ? (
        <p className="mt-1 text-xs text-green-700 dark:text-green-400">
          Message delivered — task resumed
        </p>
      ) : null}
      {sendError !== null ? (
        sendError.code === 'WORKER_UNAVAILABLE' ? (
          <div className="mt-2 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>Worker <strong>{workerName}</strong> is offline — task can only be continued when this worker is back online</span>
          </div>
        ) : (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{sendError.message}</p>
        )
      ) : null}
    </div>
  );
}
