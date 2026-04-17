/**
 * Modal for starting a backfill run. Two date inputs (from, to) with
 * validation: fromDate <= toDate <= today.
 */

import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';

interface BackfillRangeModalProps {
  readonly isOpen: boolean;
  readonly onConfirm: (fromDate: string, toDate: string) => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly error: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function BackfillRangeModal({
  isOpen,
  onConfirm,
  onCancel,
  busy,
  error,
}: BackfillRangeModalProps): React.JSX.Element | null {
  const today = todayIso();
  const [fromDate, setFromDate] = useState<string>(() => daysAgoIso(7));
  const [toDate, setToDate] = useState<string>(() => today);

  const validationError = useMemo<string | null>(() => {
    if (fromDate === '' || toDate === '') return 'Wybierz obie daty';
    if (fromDate > toDate) return 'Data „od" musi być wcześniejsza lub równa „do"';
    if (toDate > today) return 'Data „do" nie może być w przyszłości';
    return null;
  }, [fromDate, toDate, today]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-3 flex items-start gap-3">
          <CalendarRange className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Uzupełnij podsumowania z zakresu dat
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Każdy dzień w zakresie zostanie przetworzony osobno. Postęp możesz śledzić na osobnej stronie.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Od</span>
            <input
              type="date"
              value={fromDate}
              max={today}
              onChange={(e): void => { setFromDate(e.target.value); }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Do</span>
            <input
              type="date"
              value={toDate}
              max={today}
              onChange={(e): void => { setToDate(e.target.value); }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
        {validationError !== null ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{validationError}</p>
        ) : null}
        {error !== null ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
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
            onClick={(): void => { onConfirm(fromDate, toDate); }}
            disabled={busy || validationError !== null}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Uruchamianie…' : 'Rozpocznij'}
          </button>
        </div>
      </div>
    </div>
  );
}
