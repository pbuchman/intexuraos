/**
 * ChatPanel - Desktop conversation panel.
 * Fixed position, bottom-right corner, above FAB.
 * Displays messages, typing indicator, pending action confirmations, and input area.
 */

import { useEffect, useRef } from 'react';
import { Minimize2, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { ChatMessage } from './ChatMessage.js';
import { ChatInput } from './ChatInput.js';
import type { ChatMessage as ChatMessageType, SuggestedAction } from '../../types/chat';

interface ChatPanelProps {
  isOpen: boolean;
  messages: ChatMessageType[];
  isLoading: boolean;
  error: string | null;
  pendingAction: SuggestedAction | null;
  onSendMessage: (message: string) => void;
  onClose: () => void;
  onClear: () => void;
}

export function ChatPanel({
  isOpen,
  messages,
  isLoading,
  error,
  pendingAction,
  onSendMessage,
  onClose,
  onClear,
}: ChatPanelProps): React.JSX.Element | null {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, error, pendingAction]);

  if (!isOpen) return null;

  const pendingCommandText = pendingAction?.payload['text'] as string | undefined;

  return (
    <div className="hidden bottom-20 right-4 z-50 md:flex fixed w-96 flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold">
            I
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Intex</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClear}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close chat"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex max-h-[60vh] min-h-[200px] flex-col overflow-y-auto px-4 py-3">
        {messages.length === 0 && !isLoading && !error && (
          <div className="flex flex-1 items-center justify-center text-gray-500 dark:text-gray-400">
            <p className="text-center text-sm">
              Ask me anything about IntexuraOS.<br />
              I can help you navigate the system.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            isUser={message.role === 'user'}
          />
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" data-testid="loader-icon" />
            <span>Thinking...</span>
          </div>
        )}

        {/* Error display */}
        {error !== null && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            <p className="font-semibold">Error</p>
            <p>{error}</p>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Pending action confirmation */}
      {pendingAction !== null && pendingAction.awaitingConfirmation && (
        <div className="border-t border-gray-200 bg-blue-50 px-4 py-3 dark:border-gray-700 dark:bg-blue-900/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 dark:text-blue-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Confirm action
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Say "yes" to create: <em>"{pendingCommandText}"</em>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Input area */}
      <ChatInput onSend={onSendMessage} disabled={isLoading} {...(pendingAction?.awaitingConfirmation ? { placeholder: 'Say "yes" to confirm...' } : {})} />
    </div>
  );
}
