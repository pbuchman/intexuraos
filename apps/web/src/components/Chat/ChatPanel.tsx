/**
 * ChatPanel - Desktop conversation panel.
 * Fixed position, bottom-right corner, above FAB.
 * Displays messages, typing indicator, pending action confirmations, and input area.
 * Resizable via drag handle at top-left corner.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Trash2, Loader2, AlertCircle } from 'lucide-react';
import { ChatMessage } from './ChatMessage.js';
import { ChatInput } from './ChatInput.js';
import { Button } from '../ui/Button.js';
import type { ChatMessage as ChatMessageType, SuggestedAction } from '../../types/chat.js';

/**
 * Format time for separator display (e.g., "11:33 AM" or "Yesterday, 3:45 PM")
 */
function formatTimeSeparator(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (messageDate.getTime() === today.getTime()) {
    return timeStr;
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return `Yesterday, ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${dateStr}, ${timeStr}`;
  }
}

/**
 * Determine if a time separator should be shown before this message.
 * Shows separator when: first message, different day, or >5 min gap.
 */
function shouldShowTimeSeparator(
  message: ChatMessageType,
  prevMessage?: ChatMessageType
): boolean {
  if (prevMessage === undefined) return true;

  const currTime = new Date(message.timestamp);
  const prevTime = new Date(prevMessage.timestamp);

  const currDate = new Date(currTime.getFullYear(), currTime.getMonth(), currTime.getDate());
  const prevDate = new Date(prevTime.getFullYear(), prevTime.getMonth(), prevTime.getDate());
  if (currDate.getTime() !== prevDate.getTime()) return true;

  const gapMinutes = (message.timestamp - prevMessage.timestamp) / (1000 * 60);
  return gapMinutes > 5;
}

/**
 * Time separator component - centered timestamp between message groups
 */
function TimeSeparator({ timestamp }: { timestamp: number }): React.JSX.Element {
  return (
    <div className="flex justify-center my-3">
      <span className="text-xs text-gray-400 dark:text-gray-500" data-testid="chat-message-timestamp">
        {formatTimeSeparator(timestamp)}
      </span>
    </div>
  );
}

/** Default dimensions for the chat panel */
const DEFAULT_WIDTH = 384; // w-96 in Tailwind
const DEFAULT_HEIGHT = 500;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 300;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 900;

export interface ChatPanelSize {
  width: number;
  height: number;
}

interface ChatPanelProps {
  isOpen: boolean;
  messages: ChatMessageType[];
  isLoading: boolean;
  error: string | null;
  pendingAction: SuggestedAction | null;
  onSendMessage: (message: string) => void;
  onClear: () => void;
  /** Initial size (from localStorage) */
  initialSize?: ChatPanelSize;
  /** Callback when size changes (for persistence) */
  onSizeChange?: (size: ChatPanelSize) => void;
  /** User's profile picture URL */
  userPicture?: string;
}

export function ChatPanel({
  isOpen,
  messages,
  isLoading,
  error,
  pendingAction,
  onSendMessage,
  onClear,
  initialSize,
  onSizeChange,
  userPicture,
}: ChatPanelProps): React.JSX.Element | null {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChatPanelSize>({
    width: initialSize?.width ?? DEFAULT_WIDTH,
    height: initialSize?.height ?? DEFAULT_HEIGHT,
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, error, pendingAction]);

  // Handle resize mouse/touch move
  const handleResizeMove = useCallback((clientX: number, clientY: number) => {
    if (resizeStartRef.current === null) return;

    const { x: startX, y: startY, width: startWidth, height: startHeight } = resizeStartRef.current;

    // Calculate delta (negative because dragging top-left corner)
    const deltaX = startX - clientX;
    const deltaY = startY - clientY;

    // Calculate new dimensions with constraints
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + deltaX));
    const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + deltaY));

    setSize({ width: newWidth, height: newHeight });
  }, []);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    if (resizeStartRef.current !== null) {
      setIsResizing(false);
      resizeStartRef.current = null;
      // Notify parent of size change for persistence
      onSizeChange?.(size);
    }
  }, [size, onSizeChange]);

  // Mouse event handlers
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent): void => {
      e.preventDefault();
      handleResizeMove(e.clientX, e.clientY);
    };

    const handleMouseUp = (): void => {
      handleResizeEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return (): void => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Start resize on mouse down
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
    const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;

    resizeStartRef.current = {
      x: clientX,
      y: clientY,
      width: size.width,
      height: size.height,
    };
  }, [size]);

  // Touch event handlers for resize
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch !== undefined) {
      handleResizeMove(touch.clientX, touch.clientY);
    }
  }, [handleResizeMove]);

  const handleTouchEnd = useCallback(() => {
    handleResizeEnd();
  }, [handleResizeEnd]);

  if (!isOpen) return null;

  const pendingCommandText = typeof pendingAction?.payload['text'] === 'string' ? pendingAction.payload['text'] : undefined;

  return (
    <div
      ref={panelRef}
      className={`fixed bottom-20 right-4 z-50 hidden md:flex flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 ${isResizing ? 'select-none' : ''}`}
      // eslint-disable-next-line no-restricted-syntax -- Dynamic resize dimensions require inline style (Tailwind classes are static)
      style={{ width: size.width, height: size.height }}
    >
      {/* Resize handle - top-left corner */}
      <div
        className="absolute -top-1 -left-1 w-4 h-4 cursor-nwse-resize z-10 group"
        onMouseDown={handleResizeStart}
        onTouchStart={handleResizeStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        aria-label="Resize chat panel"
        role="separator"
        aria-orientation="horizontal"
      >
        {/* Visual indicator */}
        <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-gray-300 group-hover:bg-blue-500 dark:bg-gray-600 dark:group-hover:bg-blue-400 transition-colors" />
      </div>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <img
            src="/apple-touch-icon-180x180.png"
            alt="Intex"
            className="h-8 w-8 rounded-full"
          />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Intex</h2>
        </div>
        <button
          onClick={onClear}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label="Clear conversation"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 flex flex-col overflow-y-auto px-4 py-3">
        {messages.length === 0 && !isLoading && !error && (
          <div className="flex gap-2 mb-2">
            <img
              src="/apple-touch-icon-180x180.png"
              alt="Intex"
              className="h-8 w-8 shrink-0 rounded-full"
            />
            <div className="max-w-[80%] rounded-2xl bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 px-4 py-2">
              <p className="text-sm">
                👋 Hi! I'm <strong>Intex</strong>, your IntexuraOS assistant.
              </p>
              <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
                I can help you navigate the system, answer questions, and assist with commands.
              </p>
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          const prevMessage = index > 0 ? messages[index - 1] : undefined;
          const showSeparator = shouldShowTimeSeparator(message, prevMessage);

          return (
            <div key={message.id}>
              {showSeparator && <TimeSeparator timestamp={message.timestamp} />}
              <ChatMessage
                message={message}
                isUser={message.role === 'user'}
                {...(message.role === 'user' && userPicture !== undefined && { userPicture })}
              />
            </div>
          );
        })}

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
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 dark:text-blue-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Confirm action
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Create: <em>"{pendingCommandText ?? 'this command'}"</em>
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

      {/* Input area */}
      <ChatInput onSend={onSendMessage} disabled={isLoading} />
    </div>
  );
}
