import { CheckCircle2, Circle, Clock, ExternalLink } from 'lucide-react';
import type { LinearIssue } from '@/types';
import { stripMarkdown } from '@/utils/markdownUtils';
import { PRIORITY_COLORS, PRIORITY_LABELS } from './constants.js';

interface IssueCardProps {
  issue: LinearIssue;
}

export function IssueCard({ issue }: IssueCardProps): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white transition-all hover:border-blue-300 hover:shadow-md dark:border-slate-600 dark:bg-slate-700 dark:hover:border-blue-500">
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-4"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{issue.identifier}</span>
            {issue.labels.length > 0 && (
              <span className="flex items-center gap-1">
                {issue.labels.map((label) => (
                  <span
                    key={label.id}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    // eslint-disable-next-line no-restricted-syntax -- Dynamic label colors from API require inline styles
                    style={{ backgroundColor: `${label.color}20`, color: label.color }}
                  >
                    {label.name}
                  </span>
                ))}
              </span>
            )}
            {issue.assignee !== undefined && issue.assignee !== null && (
              <span className="inline-flex items-center rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-700 dark:text-emerald-100">{issue.assignee.name}</span>
            )}
          </div>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${String(PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS[0])}`}
          >
            {PRIORITY_LABELS[issue.priority] ?? 'No priority'}
          </span>
        </div>

        <h4 className="mb-2 font-medium text-slate-900 line-clamp-2 dark:text-slate-100">{issue.title}</h4>

        {issue.description !== null && issue.description !== '' && (
          <p className="mb-2 text-sm text-slate-500 line-clamp-2 dark:text-slate-400">
            {stripMarkdown(issue.description)}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
          <span>{issue.state?.name ?? 'Unknown'}</span>
          <ExternalLink className="h-3 w-3" />
        </div>
      </a>

      {/* Sub-issues list */}
      {issue.children.length > 0 && <SubIssuesList issues={issue.children} />}
    </div>
  );
}

interface SubIssuesListProps {
  issues: LinearIssue[];
}

function SubIssuesList({ issues }: SubIssuesListProps): React.JSX.Element | null {
  if (issues.length === 0) {
    return null;
  }

  // Status icon mapping
  const getStatusIcon = (issue: LinearIssue): React.ReactNode => {
    if (!issue.state) {
      return <Circle className="h-3 w-3 text-slate-400" />;
    }
    const type = issue.state.type;
    switch (type) {
      case 'backlog':
      case 'unstarted':
        return <Circle className="h-3 w-3 text-slate-400" />;
      case 'started':
        return <Clock className="h-3 w-3 text-blue-500" />;
      case 'completed':
      case 'cancelled':
        return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      default:
        return <Circle className="h-3 w-3 text-slate-400" />;
    }
  };

  return (
    <div className="mt-3 border-t border-slate-200 px-3 pt-3 pb-1 dark:border-slate-600">
      <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
        Sub-issues ({issues.length})
      </div>

      <div className="space-y-1.5">
        {issues.map((child) => (
          <a
            key={child.id}
            href={child.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded px-3 py-2 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            {getStatusIcon(child)}
            <span className="font-medium text-slate-500 dark:text-slate-500">{child.identifier}</span>
            <span className="truncate">{child.title}</span>
            {child.labels.length > 0 && (
              <span className="flex items-center gap-1">
                {child.labels.map((label) => (
                  <span
                    key={label.id}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    // eslint-disable-next-line no-restricted-syntax -- Dynamic label colors from API require inline styles
                    style={{ backgroundColor: `${label.color}20`, color: label.color }}
                  >
                    {label.name}
                  </span>
                ))}
              </span>
            )}
            {child.assignee !== undefined && child.assignee !== null && (
              <span className="inline-flex items-center rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-700 dark:text-emerald-100">{child.assignee.name}</span>
            )}
            <ExternalLink className="ml-auto h-3 w-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        ))}
      </div>
    </div>
  );
}
