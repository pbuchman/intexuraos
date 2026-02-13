import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { CodeTaskStatus } from '@/types';

interface TerminalMessageInputProps {
  taskStatus: CodeTaskStatus;
  onSend: (message: string) => Promise<void>;
}

export function TerminalMessageInput({ taskStatus, onSend }: TerminalMessageInputProps): React.JSX.Element | null {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = taskStatus === 'running' || taskStatus === 'dispatched';
  if (!isRunning) return null;

  const handleSubmit = async (): Promise<void> => {
    const trimmed = input.trim();
    if (trimmed === '' || sending) return;

    setSending(true);
    setError(null);

    try {
      await onSend(trimmed);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const canSend = input.trim() !== '' && !sending;

  return (
    <div className="border-t border-slate-700 bg-slate-800 px-3 py-2 rounded-b-lg">
      {error !== null ? (
        <div className="mb-2 text-xs text-red-400">{error}</div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e): void => { setInput(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder="Send a message to the running task..."
          disabled={sending}
          rows={1}
          className="flex-1 resize-none rounded border border-slate-600 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 h-[32px] max-h-[100px]"
        />
        <button
          type="button"
          onClick={(): void => { void handleSubmit(); }}
          disabled={!canSend}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-slate-600 disabled:opacity-50"
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
