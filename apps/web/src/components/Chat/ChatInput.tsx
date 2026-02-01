/**
 * ChatInput - Message input area with send button.
 * Enter sends, Shift+Enter for newline.
 * Disabled while waiting for response.
 */

import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps): React.JSX.Element {
  const [input, setInput] = useState('');

  const handleSubmit = (): void => {
    const trimmed = input.trim();
    if (trimmed !== '' && !disabled) {
      onSend(trimmed);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = input.trim() !== '' && !disabled;

  return (
    <div className="flex items-end gap-2 border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <textarea
        value={input}
        onChange={(e): void => {
          setInput(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type your message..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 h-[40px] max-h-[120px]"
      />
      <button
        onClick={handleSubmit}
        disabled={!canSend}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-gray-300 disabled:opacity-50 dark:disabled:bg-gray-600"
        aria-label="Send message"
      >
        {disabled ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Send className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}
