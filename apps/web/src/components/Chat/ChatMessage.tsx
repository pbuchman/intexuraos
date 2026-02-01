/**
 * ChatMessage - Displays a single chat message.
 * User messages: right-aligned, primary color.
 * Assistant messages: left-aligned, secondary color with copy button.
 */

import { useState } from 'react';
import { Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType } from '../../types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  isUser: boolean;
}

export function ChatMessage({ message, isUser }: ChatMessageProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      void setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Silently fail if clipboard is unavailable
    }
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      data-testid={`chat-message-${isUser ? 'user' : 'assistant'}`}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {/* Avatar for assistant */}
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-medium">
          I
        </div>
      )}

      {/* Message bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
        }`}
      >
        {/* Message content with markdown rendering */}
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="my-1">{children}</p>,
              ul: ({ children }) => <ul className="my-1 list-inside list-disc">{children}</ul>,
              ol: ({ children }) => <ol className="my-1 list-inside list-decimal">{children}</ol>,
              code: ({ className, children }) => {
                const isInline = !className?.includes('language-');
                if (isInline) {
                  return (
                    <code
                      className={`rounded px-1 py-0.5 text-sm ${
                        isUser
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                      }`}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={`block rounded-lg px-3 py-2 text-sm ${isUser ? 'bg-blue-500' : 'bg-gray-800'}`}>
                    <pre className="whitespace-pre-wrap">{children}</pre>
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Timestamp and copy button */}
        <div className={`mt-1 flex items-center gap-2 text-xs opacity-70 ${
          isUser ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
        }`}>
          <time data-testid="chat-message-timestamp">{formatTime(message.timestamp)}</time>
          {!isUser && (
            <button
              onClick={(): void => {
                void handleCopy();
              }}
              className="flex items-center gap-1 hover:opacity-100 focus:outline-none"
              aria-label="Copy message"
            >
              <Copy className="h-3 w-3" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* Avatar for user */}
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-600 text-white text-sm font-medium">
          U
        </div>
      )}
    </div>
  );
}
