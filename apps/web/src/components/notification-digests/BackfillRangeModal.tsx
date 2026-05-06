import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { daysAgoIso, todayIso } from '@/utils/digestDates';

interface BackfillRangeModalProps {
  readonly isOpen: boolean;
  readonly onConfirm: (fromDate: string, toDate: string) => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly error: string | null;
}

export function BackfillRangeModal({
  isOpen,
  onConfirm,
  onCancel,
  busy,
  error,
}: BackfillRangeModalProps): React.JSX.Element {
  const today = todayIso();
  const [fromDate, setFromDate] = useState<string>(() => daysAgoIso(7));
  const [toDate, setToDate] = useState<string>(() => today);

  const validationError = useMemo<string | null>(() => {
    if (fromDate === '' || toDate === '') return 'Select both dates';
    if (fromDate > toDate) return 'The "from" date must be before or equal to the "to" date';
    if (toDate > today) return 'The "to" date cannot be in the future';
    return null;
  }, [fromDate, toDate, today]);

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open && !busy) onCancel();
      }}
      title="Backfill digests for a date range"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mb-3 flex items-start gap-3">
        <CalendarRange className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Backfill digests for a date range
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Each day in the range will be processed separately. Progress is tracked on a separate page.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">From</span>
          <input
            type="date"
            value={fromDate}
            max={today}
            onChange={(e): void => { setFromDate(e.target.value); }}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">To</span>
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
          Cancel
        </button>
        <button
          type="button"
          onClick={(): void => { onConfirm(fromDate, toDate); }}
          disabled={busy || validationError !== null}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Starting...' : 'Start'}
        </button>
      </div>
    </Modal>
  );
}
