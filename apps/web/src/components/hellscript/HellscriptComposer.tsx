import { useState, useRef } from 'react';
import { Send } from 'lucide-react';

interface HellscriptComposerProps {
  onSubmit: (utterance: string) => Promise<void>;
  disabled: boolean;
}

export function HellscriptComposer({
  onSubmit,
  disabled,
}: HellscriptComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === '' || disabled) return;

    try {
      await onSubmit(trimmed);
      setText('');
    } catch {
      // Text preserved for retry; error display handled by useHellscriptWorkspace
    }
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e): void => {
          setText(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a thought... (Enter to send, Shift+Enter for newline)"
        disabled={disabled}
        maxLength={10000}
        rows={3}
        className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400"
      />
      <button
        onClick={(): void => {
          void handleSubmit();
        }}
        disabled={disabled || text.trim() === ''}
        className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
        aria-label="Send"
      >
        {disabled ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
