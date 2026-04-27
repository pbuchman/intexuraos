import type { LinearIssue } from '@/types';
import { IssueCard } from './IssueCard.js';

interface IssueColumnProps {
  title: string;
  icon: React.ReactNode;
  issues: LinearIssue[];
  colorClass?: string;
}

export function IssueColumn({
  title,
  icon,
  issues,
  colorClass = 'bg-slate-50 dark:bg-slate-800',
}: IssueColumnProps): React.JSX.Element {
  return (
    <div className={`flex flex-col rounded-lg ${colorClass} p-4`}>
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-600 dark:text-slate-300">
          {issues.length}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {issues.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8 dark:text-slate-500">No issues</p>
        ) : (
          issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        )}
      </div>
    </div>
  );
}
