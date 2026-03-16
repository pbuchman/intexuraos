/**
 * ChatBottomSheet - Mobile bottom sheet conversation panel.
 * Expandable from 60vh to 100vh (60-100% of viewport height) with drag handle.
 * Swipe down to dismiss support.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MoreVertical, Loader2, X, AlertCircle } from 'lucide-react';
import { ChatMessage } from './ChatMessage.js';
import { ChatInput } from './ChatInput.js';
import { Button } from '../ui/Button.js';
import type { ChatMessage as ChatMessageType, SuggestedAction } from '../../types/chat.js';

interface ChatBottomSheetProps {
  isOpen: boolean;
  messages: ChatMessageType[];
  isLoading: boolean;
  error: string | null;
  pendingAction: SuggestedAction | null;
  onSendMessage: (message: string) => void;
  onClose: () => void;
  onClear: () => void;
  /** User's profile picture URL */
  userPicture?: string;
}

export function ChatBottomSheet({
  isOpen,
  messages,
  isLoading,
  error,
  pendingAction,
  onSendMessage,
  onClose,
  onClear,
  userPicture,
}: ChatBottomSheetProps): React.JSX.Element | null {
  const sheetRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [startY, setStartY] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, error, pendingAction]);

  // Reset dropdown when sheet closes
  useEffect(() => {
    if (!isOpen) {
      setIsMenuOpen(false);
    }
  }, [isOpen]);

  // Close on escape key (dismiss dropdown first, then sheet)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (isMenuOpen) {
          setIsMenuOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return (): void => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, isMenuOpen]);

  // Close menu on outside click (only listens when menu is open)
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target;
      if (target instanceof Node && menuRef.current !== null && !menuRef.current.contains(target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  // Handle drag start
  const handleDragStart = useCallback((clientY: number) => {
    setIsDragging(true);
    setStartY(clientY);
  }, []);

  // Handle drag move
  const handleDragMove = useCallback(
    (clientY: number) => {
      if (!isDragging) return;

      const deltaY = clientY - startY;

      // If dragged down significantly and not at top, close
      if (deltaY > 100 && deltaY < 300) {
        setIsDragging(false);
        onClose();
        return;
      }

      // If dragged up significantly, expand
      if (deltaY < -100) {
        setIsExpanded(true);
      } else if (deltaY > 50 && isExpanded) {
        setIsExpanded(false);
      }
    },
    [isDragging, startY, isExpanded, onClose]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch events
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleDragStart(touch.clientY);
    },
    [handleDragStart]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleDragMove(touch.clientY);
    },
    [handleDragMove]
  );

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Mouse events (for desktop testing) - using window listeners to capture mouse outside element
  const handleWindowMouseMove = useCallback(
    (e: MouseEvent) => {
      handleDragMove(e.clientY);
    },
    [handleDragMove]
  );

  const handleWindowMouseUp = useCallback(() => {
    handleDragEnd();
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [handleDragEnd, handleWindowMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleDragStart(e.clientY);
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    },
    [handleDragStart, handleWindowMouseMove, handleWindowMouseUp]
  );

  // Cleanup window listeners on unmount
  useEffect(() => {
    return (): void => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [handleWindowMouseMove, handleWindowMouseUp]);

  // Toggle expand state
  const toggleExpand = useCallback((): void => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      ref={sheetRef}
      className={`fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white dark:bg-gray-900 shadow-2xl md:hidden ${isDragging ? '' : 'transition-[height] duration-300 ease-out'} ${isExpanded ? 'h-[100vh] max-h-[100vh]' : 'h-[60vh] max-h-[60vh]'}`}
    >
      <div
        className="flex shrink-0 cursor-grab select-none items-center justify-between border-b border-gray-200 px-4 py-2 active:cursor-grabbing dark:border-gray-700"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <img
            src="/apple-touch-icon-180x180.png"
            alt="Intex"
            className="h-7 w-7 rounded-full"
          />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Intex
          </h2>
        </div>

        <div
          className="flex items-center gap-1"
          onMouseDown={(e) => { e.stopPropagation(); }}
          onTouchStart={(e) => { e.stopPropagation(); }}
        >
          {/* Dropdown menu */}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => { setIsMenuOpen((prev) => !prev); }}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              aria-label="More options"
              aria-expanded={isMenuOpen}
              aria-haspopup="true"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {isMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { toggleExpand(); setIsMenuOpen(false); }}
                  className="flex w-full items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  {isExpanded ? 'Collapse' : 'Expand'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { onClear(); setIsMenuOpen(false); }}
                  className="flex w-full items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Clear conversation
                </button>
              </div>
            )}
          </div>

          {/* Close button stays standalone */}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-3">
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
            {...(message.role === 'user' && userPicture !== undefined && { userPicture })}
          />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" data-testid="loader-icon" />
            <span>Thinking...</span>
          </div>
        )}

        {error !== null && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            <p className="font-semibold">Error</p>
            <p>{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {pendingAction !== null && pendingAction.awaitingConfirmation && (
        <div className="border-t border-gray-200 bg-blue-50 px-4 py-3 dark:border-gray-700 dark:bg-blue-900/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 dark:text-blue-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Confirm action
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Create: <em>"{typeof pendingAction.payload['text'] === 'string' ? pendingAction.payload['text'] : 'this command'}"</em>
              </p>
              <div className="flex gap-2 mt-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isLoading}
                  onClick={() => { onSendMessage('yes'); }}
                  className="text-xs"
                >
                  ✓ Yes
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isLoading}
                  onClick={() => { onSendMessage('cancel'); }}
                  className="text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-4 py-3">
        <ChatInput onSend={onSendMessage} disabled={isLoading} />
      </div>

      {!isExpanded && (
        <div className="flex justify-center py-1">
          <p className="text-xs text-gray-400 dark:text-gray-500">Swipe down to close</p>
        </div>
      )}
    </div>
  );
}

// Note: Responsive switching is handled in Chat.tsx via Tailwind CSS classes:
// - ChatBottomSheet: hidden on md+ screens (md:hidden)
// - ChatPanel: visible only on md+ screens (hidden md:flex)
// This CSS-based approach is preferred over JavaScript component switching.
