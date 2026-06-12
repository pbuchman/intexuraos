import { ArrowUpDown } from 'lucide-react';

interface SortOption<K extends string> {
  key: K;
  label: string;
}

interface InboxSortBarProps<K extends string> {
  options: SortOption<K>[];
  active: K;
  onChange: (key: K) => void;
}

export function InboxSortBar<K extends string>({ options, active, onChange }: InboxSortBarProps<K>): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2">
      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
      <div className="flex gap-1.5">
        {options.map(({ key, label }) => (
          <button
            key={key}
            onClick={(): void => {
              onChange(key);
            }}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              active === key
                ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
