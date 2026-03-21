import type { PrFilterStatus } from '@/types';

interface PrStatusPipelineProps {
  counts: Record<PrFilterStatus, number>;
  activeFilters: Set<PrFilterStatus>;
  onToggle: (status: PrFilterStatus) => void;
}

const STATUS_CONFIG: Record<PrFilterStatus, {
  label: string;
  dotClass: string;
  activeClass: string;
}> = {
  mergeable: {
    label: 'Mergeable',
    dotClass: 'bg-green-500',
    activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  },
  pending: {
    label: 'Pending',
    dotClass: 'bg-amber-500',
    activeClass: 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400',
  },
  blocked: {
    label: 'Blocked',
    dotClass: 'bg-red-500',
    activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400',
  },
};

const INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400';

const STATUSES: PrFilterStatus[] = ['mergeable', 'pending', 'blocked'];

export function PrStatusPipeline({ counts, activeFilters, onToggle }: PrStatusPipelineProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUSES.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const isActive = activeFilters.has(status);
        return (
          <button
            key={status}
            onClick={(): void => { onToggle(status); }}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive ? cfg.activeClass : INACTIVE_CLASS
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${cfg.dotClass}`} />
            <span>{cfg.label}</span>
            <span className="font-medium">{String(counts[status])}</span>
          </button>
        );
      })}
    </div>
  );
}
