import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Clock, Eye } from 'lucide-react';
import type { LinearIssue } from '@/types';
import { IssueCard } from './IssueCard.js';
import { IssueColumn } from './IssueColumn.js';
import { StackedColumn } from './StackedColumn.js';
import { TABS, type TabType } from './constants.js';

export interface ColumnIssues {
  todo: LinearIssue[];
  backlog: LinearIssue[];
  in_progress: LinearIssue[];
  in_review: LinearIssue[];
  to_test: LinearIssue[];
  done: LinearIssue[];
  archive: LinearIssue[];
}

export function toColumnIssues(
  data: { issues: ColumnIssues } | null
): ColumnIssues {
  return {
    todo: data?.issues.todo ?? [],
    backlog: data?.issues.backlog ?? [],
    in_progress: data?.issues.in_progress ?? [],
    in_review: data?.issues.in_review ?? [],
    to_test: data?.issues.to_test ?? [],
    done: data?.issues.done ?? [],
    archive: data?.issues.archive ?? [],
  };
}

interface IssueBoardProps {
  columnIssues: ColumnIssues;
}

export function IssueBoard({ columnIssues }: IssueBoardProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabType>('todo');
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  return (
    <>
      {/* Mobile: Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 md:hidden dark:bg-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
            }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">({columnIssues[tab.id].length})</span>
          </button>
        ))}
      </div>

      {/* Mobile: Active column */}
      <div className="md:hidden">
        {activeTab === 'archive' ? (
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                setArchiveExpanded(!archiveExpanded);
              }}
              className="mb-4 flex w-full items-center justify-between rounded-lg bg-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Archive ({columnIssues.archive.length} older completed issues)
              </span>
              {archiveExpanded ? (
                <ChevronUp className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              )}
            </button>

            {archiveExpanded && (
              <div className="mt-4 space-y-3">
                {columnIssues.archive.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <IssueColumn
            title={TABS.find((t) => t.id === activeTab)?.label ?? ''}
            icon={TABS.find((t) => t.id === activeTab)?.icon}
            issues={columnIssues[activeTab]}
          />
        )}
      </div>

      {/* Desktop: 3-column layout with stacked sections */}
      <div className="hidden md:grid md:grid-cols-3 md:gap-4">
        {/* Column 1: Todo + Backlog (stacked) */}
        <StackedColumn
          title="Planning"
          colorClass="bg-slate-200/50 dark:bg-slate-800"
          sections={[
            {
              title: 'Todo',
              icon: <Circle className="h-3 w-3 text-blue-400" />,
              issues: columnIssues.todo,
              colorClass: 'bg-blue-50 dark:bg-blue-900/20',
            },
            {
              title: 'Backlog',
              icon: <Circle className="h-3 w-3 text-slate-400" />,
              issues: columnIssues.backlog,
              colorClass: 'bg-slate-50 dark:bg-slate-700/50',
            },
          ]}
        />

        {/* Column 2: In Progress → In Review → To Test (stacked) */}
        <StackedColumn
          title="In Progress"
          sections={[
            {
              title: 'In Progress',
              icon: <Clock className="h-3 w-3 text-blue-500" />,
              issues: columnIssues.in_progress,
              colorClass: 'bg-orange-50 dark:bg-orange-900/20',
            },
            {
              title: 'In Review',
              icon: <Eye className="h-3 w-3 text-purple-500" />,
              issues: columnIssues.in_review,
              colorClass: 'bg-purple-50 dark:bg-purple-900/20',
            },
            {
              title: 'To Test',
              icon: <CheckCircle2 className="h-3 w-3 text-amber-500" />,
              issues: columnIssues.to_test,
              colorClass: 'bg-amber-50 dark:bg-amber-900/20',
            },
          ]}
          colorClass="bg-blue-50 dark:bg-slate-800"
        />

        {/* Column 3: Recently Closed */}
        <IssueColumn
          title="Recently Closed"
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          issues={columnIssues.done}
          colorClass="bg-green-50 dark:bg-slate-800"
        />
      </div>

      {/* Archive section (desktop) */}
      {columnIssues.archive.length > 0 && (
        <div className="mt-6 hidden md:block">
          <button
            type="button"
            onClick={() => {
              setArchiveExpanded(!archiveExpanded);
            }}
            className="flex w-full items-center justify-between rounded-lg bg-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Archive ({columnIssues.archive.length} older completed issues)
            </span>
            {archiveExpanded ? (
              <ChevronUp className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            )}
          </button>

          {archiveExpanded && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {columnIssues.archive.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
