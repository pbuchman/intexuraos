# Task 4-2: Create Linear Issues Dashboard Page

## Tier

4 (Web App)

## Context

Connection page is complete. Now create the issues dashboard with 3 columns + archive.

## Problem Statement

Need to create LinearIssuesPage that:

1. Shows issues in columns: Backlog+Todo, In Progress, In Review
2. Done column filtered to last week
3. Archive section (collapsed by default)
4. Mobile-responsive with tabs
5. Polling every minute
6. Click to open Linear URL

## Scope

### In Scope

- `apps/web/src/pages/LinearIssuesPage.tsx`
- Column layout for desktop
- Tab layout for mobile
- Archive accordion
- Auto-refresh polling
- Link to Linear for each issue

### Out of Scope

- Issue editing (read-only)
- Navigation updates (next task)

## Required Approach

1. **Study** `apps/web/src/pages/CalendarPage.tsx` for layout patterns
2. **Create** responsive layout with columns/tabs
3. **Use** TailwindCSS for styling
4. **Implement** polling with useEffect interval

## Step Checklist

- [ ] Create `apps/web/src/pages/LinearIssuesPage.tsx`
- [ ] Implement desktop column layout
- [ ] Implement mobile tab layout
- [ ] Implement archive accordion
- [ ] Implement 1-minute polling
- [ ] Add issue cards with click-to-open
- [ ] Export from `apps/web/src/pages/index.ts`
- [ ] TypeCheck web app

## Definition of Done

- Page shows issues in correct columns
- Mobile tabs work correctly
- Polling refreshes data
- Issues link to Linear
- TypeScript compiles

## Verification Commands

```bash
cd apps/web
pnpm run typecheck
cd ../..
```

## Rollback Plan

```bash
rm apps/web/src/pages/LinearIssuesPage.tsx
```

## Reference Files

- `apps/web/src/pages/CalendarPage.tsx`
- `apps/web/src/pages/TodosListPage.tsx`

## LinearIssuesPage.tsx

```tsx
import { useState, useEffect, useCallback } from 'react';
import {
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  Eye,
} from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/hooks';
import { listLinearIssues } from '@/services';
import type { LinearIssue, GroupedIssues, ListIssuesResponse } from '@/types';

const POLLING_INTERVAL_MS = 60_000; // 1 minute

const PRIORITY_COLORS: Record<number, string> = {
  0: 'bg-slate-100 text-slate-600',
  1: 'bg-red-100 text-red-700',
  2: 'bg-orange-100 text-orange-700',
  3: 'bg-blue-100 text-blue-700',
  4: 'bg-slate-100 text-slate-500',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

type TabType = 'backlog' | 'in_progress' | 'in_review' | 'done';

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'backlog', label: 'Backlog', icon: <Circle className="h-4 w-4" /> },
  { id: 'in_progress', label: 'In Progress', icon: <Clock className="h-4 w-4" /> },
  { id: 'in_review', label: 'In Review', icon: <Eye className="h-4 w-4" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle2 className="h-4 w-4" /> },
];

interface IssueCardProps {
  issue: LinearIssue;
}

function IssueCard({ issue }: IssueCardProps): React.JSX.Element {
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{issue.identifier}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS[0]}`}
        >
          {PRIORITY_LABELS[issue.priority] ?? 'No priority'}
        </span>
      </div>

      <h4 className="mb-2 font-medium text-slate-900 line-clamp-2">{issue.title}</h4>

      {issue.description !== null && issue.description !== '' && (
        <p className="mb-2 text-sm text-slate-500 line-clamp-2">{issue.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{issue.state.name}</span>
        <ExternalLink className="h-3 w-3" />
      </div>
    </a>
  );
}

interface IssueColumnProps {
  title: string;
  icon: React.ReactNode;
  issues: LinearIssue[];
  colorClass?: string;
}

function IssueColumn({
  title,
  icon,
  issues,
  colorClass = 'bg-slate-50',
}: IssueColumnProps): React.JSX.Element {
  return (
    <div className={`flex flex-col rounded-lg ${colorClass} p-4`}>
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-slate-700">{title}</h3>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
          {issues.length}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {issues.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">No issues</p>
        ) : (
          issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        )}
      </div>
    </div>
  );
}

export function LinearIssuesPage(): React.JSX.Element {
  const { accessToken } = useAuth();
  const [data, setData] = useState<ListIssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('backlog');
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  const loadIssues = useCallback(
    async (showRefreshIndicator = false): Promise<void> => {
      if (accessToken === null) return;

      try {
        if (showRefreshIndicator) {
          setRefreshing(true);
        }
        setError(null);
        const response = await listLinearIssues(accessToken, true);
        setData(response);
      } catch (err) {
        setError('Failed to load issues. Make sure Linear is connected.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken]
  );

  // Initial load
  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  // Polling
  useEffect(() => {
    const interval = setInterval(() => {
      void loadIssues(false);
    }, POLLING_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [loadIssues]);

  const handleRefresh = (): void => {
    void loadIssues(true);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="mb-4 h-12 w-12 text-red-500" />
          <h3 className="mb-2 text-lg font-medium text-slate-900">Unable to load issues</h3>
          <p className="mb-4 text-slate-500">{error}</p>
          <Button type="button" onClick={handleRefresh}>
            Try Again
          </Button>
        </div>
      </Layout>
    );
  }

  const issues = data?.issues ?? {
    backlog: [],
    in_progress: [],
    in_review: [],
    done: [],
    archive: [],
  };

  return (
    <Layout>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Linear Issues</h2>
          <p className="text-slate-600">{data?.teamName ?? 'Your team'}'s issues</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handleRefresh}
          disabled={refreshing}
          isLoading={refreshing}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Mobile: Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 md:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={(): void => {
              setActiveTab(tab.id);
            }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="ml-1 text-xs text-slate-500">({issues[tab.id].length})</span>
          </button>
        ))}
      </div>

      {/* Mobile: Active column */}
      <div className="md:hidden">
        <IssueColumn
          title={TABS.find((t) => t.id === activeTab)?.label ?? ''}
          icon={TABS.find((t) => t.id === activeTab)?.icon}
          issues={issues[activeTab]}
        />
      </div>

      {/* Desktop: Grid of columns */}
      <div className="hidden md:grid md:grid-cols-4 md:gap-4">
        <IssueColumn
          title="Backlog"
          icon={<Circle className="h-4 w-4 text-slate-400" />}
          issues={issues.backlog}
          colorClass="bg-slate-50"
        />
        <IssueColumn
          title="In Progress"
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          issues={issues.in_progress}
          colorClass="bg-blue-50"
        />
        <IssueColumn
          title="In Review"
          icon={<Eye className="h-4 w-4 text-purple-500" />}
          issues={issues.in_review}
          colorClass="bg-purple-50"
        />
        <IssueColumn
          title="Done (This Week)"
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          issues={issues.done}
          colorClass="bg-green-50"
        />
      </div>

      {/* Archive section */}
      {issues.archive.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={(): void => {
              setArchiveExpanded(!archiveExpanded);
            }}
            className="flex w-full items-center justify-between rounded-lg bg-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-200"
          >
            <span className="font-medium text-slate-700">
              Archive ({issues.archive.length} older completed issues)
            </span>
            {archiveExpanded ? (
              <ChevronUp className="h-5 w-5 text-slate-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500" />
            )}
          </button>

          {archiveExpanded && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {issues.archive.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
```

## Update pages/index.ts

Add export:

```typescript
export { LinearIssuesPage } from './LinearIssuesPage.js';
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
