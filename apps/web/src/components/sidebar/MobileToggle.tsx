import { Menu, X } from 'lucide-react';

interface MobileOpenButtonProps {
  onOpen: () => void;
}

export function MobileOpenButton({ onOpen }: MobileOpenButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onOpen}
      className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 md:hidden"
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}

interface MobileOverlayProps {
  onClose: () => void;
}

export function MobileOverlay({ onClose }: MobileOverlayProps): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 md:hidden"
      onClick={onClose}
      aria-hidden="true"
    />
  );
}

interface MobileCloseButtonProps {
  onClose: () => void;
}

export function MobileCloseButton({ onClose }: MobileCloseButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onClose}
      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 md:hidden"
      aria-label="Close menu"
    >
      <X className="h-5 w-5" />
    </button>
  );
}
