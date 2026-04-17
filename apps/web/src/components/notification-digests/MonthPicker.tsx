import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabelPl, shiftMonth } from '@/utils/digestDates.js';

interface MonthPickerProps {
  readonly month: string; // YYYY-MM
  readonly onChange: (month: string) => void;
}

export function MonthPicker({ month, onChange }: MonthPickerProps): React.JSX.Element {
  const label = monthLabelPl(month);
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800">
      <button
        type="button"
        aria-label="Poprzedni miesiąc"
        onClick={(): void => { onChange(shiftMonth(month, -1)); }}
        className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[12ch] px-2 text-center font-medium capitalize text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <button
        type="button"
        aria-label="Następny miesiąc"
        onClick={(): void => { onChange(shiftMonth(month, 1)); }}
        className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
