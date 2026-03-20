import type { MergeQueueBranch } from '@/types';

interface BranchSelectorProps {
  branches: MergeQueueBranch[];
  selected: string | null;
  onSelect: (branch: string) => void;
}

export function BranchSelector({ branches, selected, onSelect }: BranchSelectorProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {branches.map((branch) => {
        const isActive = branch.name === selected;
        return (
          <button
            key={branch.name}
            onClick={(): void => { onSelect(branch.name); }}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span>{branch.name}</span>
            <span className="font-medium">{String(branch.openPrCount)}</span>
          </button>
        );
      })}
    </div>
  );
}
