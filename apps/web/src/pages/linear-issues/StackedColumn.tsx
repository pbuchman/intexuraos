import type { LinearIssue } from '@/types';
import { IssueCard } from './IssueCard.js';

interface StackedSectionProps {
  title: string;
  icon: React.ReactNode;
  issues: LinearIssue[];
  colorClass?: string;
}

function StackedSection({
  title,
  icon,
  issues,
  colorClass = 'bg-white dark:bg-slate-700',
}: StackedSectionProps): React.JSX.Element | null {
  if (issues.length === 0) {
    return null;
  }

  return (
    <div className={`mb-4 rounded-lg ${colorClass} p-3 last:mb-0`}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-600 dark:text-slate-300">
          {issues.length}
        </span>
      </div>

      <div className="space-y-2">
        {issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
      </div>
    </div>
  );
}

interface StackedColumnProps {
  title: string;
  sections: {
    title: string;
    icon: React.ReactNode;
    issues: LinearIssue[];
    colorClass?: string;
  }[];
  colorClass?: string;
}

export function StackedColumn({
  title,
  sections,
  colorClass = 'bg-slate-50 dark:bg-slate-800',
}: StackedColumnProps): React.JSX.Element {
  const totalIssues = sections.reduce((sum, section) => sum + section.issues.length, 0);

  return (
    <div className={`flex flex-col rounded-lg ${colorClass} p-4`}>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-600 dark:text-slate-300">
          {totalIssues}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {sections.map((section) => (
          <StackedSection
            key={section.title}
            title={section.title}
            icon={section.icon}
            issues={section.issues}
            colorClass={section.colorClass ?? 'bg-white dark:bg-slate-700'}
          />
        ))}
      </div>
    </div>
  );
}
