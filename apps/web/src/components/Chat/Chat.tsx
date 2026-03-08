/**
 * Chat - Container component managing chat state and UI.
 * Handles FAB toggle, message sending, command creation flow, and localStorage persistence.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../../context/index.js';
import { ChatFAB } from './ChatFAB.js';
import { ChatPanel, type ChatPanelSize } from './ChatPanel.js';
import { ChatBottomSheet } from './ChatBottomSheet.js';
import {
  sendMessage,
  sendGuestMessage,
  saveSession,
  loadSession,
  clearSession,
  savePanelSize,
  loadPanelSize,
  ApiError,
} from '../../services/chatService.js';
import { createCommand } from '../../services/commandsApi.js';
import type { ChatMessage, SuggestedAction } from '../../types/chat.js';

export function Chat(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<SuggestedAction | null>(null);
  const [panelSize, setPanelSize] = useState<ChatPanelSize | undefined>(undefined);
  const { getAccessToken, user, isAuthenticated } = useAuth();

  // Load panel size from localStorage on mount
  useEffect(() => {
    const savedSize = loadPanelSize();
    if (savedSize !== null) {
      setPanelSize(savedSize);
    }
  }, []);

  const handleToggle = useCallback((): void => {
    setIsOpen((prev) => {
      if (!prev) {
        const session = loadSession();
        if (session !== null) {
          setMessages(session.messages);
        }
      }
      return !prev;
    });
  }, []);

  const handlePanelSizeChange = useCallback((size: ChatPanelSize): void => {
    setPanelSize(size);
    savePanelSize(size);
  }, []);

  const handleSendMessage = useCallback(
    async (content: string): Promise<void> => {
      const userMessage: ChatMessage = {
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      setIsLoading(true);
      setError(null);

      try {
        // Use authenticated or guest API based on auth state
        let response;
        let token: string | null = null;

        if (isAuthenticated) {
          token = await getAccessToken();
          response = await sendMessage(token, content, messages, pendingAction ?? undefined);
        } else {
          response = await sendGuestMessage(content, messages, pendingAction ?? undefined);
        }

        // Handle command creation (only for authenticated users)
        if (
          isAuthenticated &&
          token !== null &&
          response.suggestedAction !== null &&
          !response.suggestedAction.awaitingConfirmation
        ) {
          const assistantResponseMessage: ChatMessage = {
            id: `msg-${crypto.randomUUID()}`,
            role: 'assistant',
            content: response.response,
            timestamp: Date.now(),
          };
          const messagesWithResponse = [...updatedMessages, assistantResponseMessage];

          try {
            const payloadText = response.suggestedAction.payload['text'];
            if (typeof payloadText !== 'string') {
              throw new Error('Invalid payload: text is not a string');
            }
            const commandText = payloadText;
            const command = await createCommand(token, { text: commandText, source: 'pwa-shared' });
            const confidencePercent = Math.round((command.classification?.confidence ?? 0) * 100);
            const classificationType = command.classification?.type ?? 'todo';

            const successMessage: ChatMessage = {
              id: `msg-${crypto.randomUUID()}`,
              role: 'assistant',
              content: `✓ Created as ${classificationType} (${String(confidencePercent)}% confident): "${commandText}"\n\n[View in Inbox →](#/inbox)`,
              timestamp: Date.now(),
            };
            const finalMessages = [...messagesWithResponse, successMessage];
            setMessages(finalMessages);
            setPendingAction(null);
            saveSession({ messages: finalMessages, createdAt: Date.now(), lastActivityAt: Date.now() });
          } catch {
            const errorMessage: ChatMessage = {
              id: `msg-${crypto.randomUUID()}`,
              role: 'assistant',
              content: 'Sorry, I couldn\'t create the command. Please try again.',
              timestamp: Date.now(),
            };
            const finalMessages = [...messagesWithResponse, errorMessage];
            setMessages(finalMessages);
            saveSession({ messages: finalMessages, createdAt: Date.now(), lastActivityAt: Date.now() });
          }
          setIsLoading(false);
          return;
        }

        const assistantMessage: ChatMessage = {
          id: `msg-${crypto.randomUUID()}`,
          role: 'assistant',
          content: response.response,
          timestamp: Date.now(),
        };
        const finalMessages = [...updatedMessages, assistantMessage];

        setMessages(finalMessages);

        if (response.suggestedAction?.awaitingConfirmation === true) {
          setPendingAction(response.suggestedAction);
        } else {
          setPendingAction(null);
        }

        saveSession({ messages: finalMessages, createdAt: Date.now(), lastActivityAt: Date.now() });
      } catch (err) {
        // Handle rate limit errors with specific message
        if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
          setError(err.message);
        } else {
          setError('Failed to send message. Please try again.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [messages, pendingAction, getAccessToken, isAuthenticated]
  );

  const handleClear = useCallback((): void => {
    setMessages([]);
    setPendingAction(null);
    clearSession();
  }, []);

  const handleClose = useCallback((): void => {
    setIsOpen(false);
  }, []);

  return (
    <>
      <ChatFAB isOpen={isOpen} onToggle={handleToggle} />
      {/* Desktop: ChatPanel (hidden on mobile) */}
      <ChatPanel
        isOpen={isOpen}
        messages={messages}
        isLoading={isLoading}
        error={error}
        pendingAction={pendingAction}
        onSendMessage={(message): void => {
          void handleSendMessage(message);
        }}
        onClear={handleClear}
        onSizeChange={handlePanelSizeChange}
        {...(panelSize !== undefined && { initialSize: panelSize })}
        {...(user?.picture !== undefined && { userPicture: user.picture })}
      />
      {/* Mobile: ChatBottomSheet (hidden on desktop) */}
      <ChatBottomSheet
        isOpen={isOpen}
        messages={messages}
        isLoading={isLoading}
        error={error}
        pendingAction={pendingAction}
        onSendMessage={(message): void => {
          void handleSendMessage(message);
        }}
        onClose={handleClose}
        onClear={handleClear}
        {...(user?.picture !== undefined && { userPicture: user.picture })}
      />
    </>
  );
}
