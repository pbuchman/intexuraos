/**
 * ChatFAB - Floating Action Button for toggling the chat panel.
 * Positioned fixed, bottom-right, above DevBar (z-50).
 */

import { MessageSquare, X } from 'lucide-react';

interface ChatFABProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function ChatFAB({ isOpen, onToggle }: ChatFABProps): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className={`fixed bottom-4 right-4 z-[51] flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isOpen ? 'hidden md:flex' : ''}`}
      aria-label={isOpen ? 'Close chat' : 'Open chat'}
    >
      {isOpen ? (
        <X className="h-6 w-6" />
      ) : (
        <MessageSquare className="h-6 w-6" />
      )}
    </button>
  );
}
