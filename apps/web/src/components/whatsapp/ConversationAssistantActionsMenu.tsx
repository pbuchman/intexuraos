import { EllipsisVertical, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export function ConversationAssistantActionsMenu({
  title,
  deleteLabel = 'Delete analysis',
  onDelete,
}: {
  title: string;
  deleteLabel?: string;
  onDelete: (trigger: HTMLButtonElement) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteItemRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      deleteItemRef.current?.focus();
    }, 0);
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (containerRef.current?.contains(event.target as Node) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return (): void => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', closeOnOutsideClick);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      onBlurCapture={(event): void => {
        if (
          open &&
          (event.relatedTarget === null ||
            !event.currentTarget.contains(event.relatedTarget as Node))
        ) {
          setOpen(false);
        }
      }}
      className="relative shrink-0"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(): void => {
          setOpen((current) => !current);
        }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <EllipsisVertical className="h-5 w-5" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          onKeyDown={(event): void => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
              return;
            }
            if (event.key === 'Tab') {
              setOpen(false);
              if (event.shiftKey) {
                event.preventDefault();
                triggerRef.current?.focus();
              }
            }
          }}
          className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <button
            ref={deleteItemRef}
            type="button"
            role="menuitem"
            onClick={(): void => {
              setOpen(false);
              const trigger = triggerRef.current;
              if (trigger !== null) onDelete(trigger);
            }}
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-4 w-4" />
            {deleteLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
