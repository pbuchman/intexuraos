import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';

export function InlineEditText({
  value,
  onSave,
  label,
  multiline,
}: {
  value: string;
  onSave: (newValue: string) => void;
  label: string;
  multiline?: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current !== null) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleSave = useCallback((): void => {
    const trimmed = draft.trim();
    if (trimmed !== '' && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  }, [draft, value, onSave]);

  const handleCancel = useCallback((): void => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && (multiline !== true || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSave, handleCancel, multiline],
  );

  if (editing) {
    return (
      <div className="flex items-start gap-2">
        {multiline === true ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e): void => {
              setDraft(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            rows={3}
            className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            aria-label={label}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e): void => {
              setDraft(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            aria-label={label}
          />
        )}
        <button
          type="button"
          onClick={handleSave}
          className="rounded p-1 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30"
          title="Save"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(): void => {
        setEditing(true);
      }}
      className="group inline-flex max-w-full items-center gap-1.5 text-left"
      title={`Edit ${label}`}
    >
      <span className="truncate">{value}</span>
      <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
