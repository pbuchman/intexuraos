/**
 * Chat - Container component managing chat state and UI.
 * Handles FAB toggle, message sending, and localStorage persistence.
 */

import { useState, useCallback } from 'react';
import { useAuth } from '../../context';
import { ChatFAB } from './ChatFAB.js';
import { ChatPanel } from './ChatPanel.js';
import { sendMessage, saveSession, loadSession, clearSession } from '../../services/chatService';
import type { ChatMessage } from '../../types/chat';

export function Chat(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getAccessToken } = useAuth();

  const handleToggle = useCallback((): void => {
    setIsOpen((prev) => {
      if (!prev) {
        // Opening: load session from storage
        const session = loadSession();
        if (session !== null) {
          setMessages(session.messages);
        }
      }
      return !prev;
    });
  }, []);

  const handleSendMessage = useCallback(
    async (content: string): Promise<void> => {
      const token = await getAccessToken();

      // Add user message
      const userMessage: ChatMessage = {
        id: `msg-${String(Date.now())}`,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      setIsLoading(true);
      setError(null);

      try {
        const response = await sendMessage(token, content, messages);

        // Add assistant response
        const assistantMessage: ChatMessage = {
          id: `msg-${String(Date.now() + 1)}`,
          role: 'assistant',
          content: response.response,
          timestamp: Date.now(),
        };
        const finalMessages = [...updatedMessages, assistantMessage];

        setMessages(finalMessages);
        saveSession({ messages: finalMessages, createdAt: Date.now(), lastActivityAt: Date.now() });
      } catch {
        setError('Failed to send message. Please try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [messages, getAccessToken]
  );

  const handleClear = useCallback((): void => {
    setMessages([]);
    clearSession();
  }, []);

  const handleClose = useCallback((): void => {
    setIsOpen(false);
  }, []);

  return (
    <>
      <ChatFAB isOpen={isOpen} onToggle={handleToggle} />
      <ChatPanel
        isOpen={isOpen}
        messages={messages}
        isLoading={isLoading}
        error={error}
        onSendMessage={(message): void => {
          void handleSendMessage(message);
        }}
        onClose={handleClose}
        onClear={handleClear}
      />
    </>
  );
}
