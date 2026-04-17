import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface RegenerateConfirmModalProps {
  readonly isOpen: boolean;
  readonly currentGeneration: number;
  readonly date: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
}

export function RegenerateConfirmModal({
  isOpen,
  currentGeneration,
  date,
  onConfirm,
  onCancel,
  busy,
}: RegenerateConfirmModalProps): React.JSX.Element | null {
  useEffect(() => {
    if (!isOpen || busy) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => { window.removeEventListener('keydown', onKeyDown); };
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(): void => { if (!busy) onCancel(); }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        onClick={(e): void => { e.stopPropagation(); }}
      >
        <div className="mb-3 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Wygenerować ponownie podsumowanie?
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Obecne podsumowanie dla dnia {date} ma generację{' '}
              <span className="font-semibold">{String(currentGeneration)}</span>.
              Nowe uruchomienie utworzy generację{' '}
              <span className="font-semibold">{String(currentGeneration + 1)}</span>{' '}
              i nadpisze obecną treść.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Generowanie…' : 'Wygeneruj ponownie'}
          </button>
        </div>
      </div>
    </div>
  );
}
