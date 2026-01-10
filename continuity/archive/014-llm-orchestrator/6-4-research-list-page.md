# Task 6-4: Create Research List Page

**Tier:** 6 (Depends on 6-2)

---

## Context Snapshot

- useResearches hook available (6-2)
- Need page to display user's researches

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create page listing all user's researches with:

1. Status indicators
2. Click to view details
3. Delete functionality
4. Pagination

---

## Scope

**In scope:**

- ResearchListPage component
- Research card component
- Status badges
- Delete confirmation
- Infinite scroll/load more

**Non-scope:**

- Research detail (task 6-5)

---

## Required Approach

### Step 1: Create page component

`apps/web/src/pages/ResearchListPage.tsx`:

```typescript
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResearches } from '../hooks/useResearch.js';
import type { Research, ResearchStatus } from '../services/ResearchAgentApi.types.js';

const STATUS_STYLES: Record<ResearchStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Pending' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Processing' },
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
};

export function ResearchListPage(): JSX.Element {
  const { researches, loading, error, hasMore, loadMore, deleteResearch } = useResearches();

  if (loading && researches.length === 0) {
    return <div className="p-6">Loading...</div>;
  }

  if (error !== null && researches.length === 0) {
    return <div className="p-6 text-red-600">Error: {error}</div>;
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Previous Researches</h1>
        <Link
          to="/#/research/new"
          className="bg-blue-600 text-white px-4 py-2 rounded font-medium"
        >
          New Research
        </Link>
      </div>

      {researches.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded">
          <p className="text-gray-600 mb-4">No researches yet</p>
          <Link to="/#/research/new" className="text-blue-600 underline">
            Start your first research
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {researches.map((research) => (
            <ResearchCard
              key={research.id}
              research={research}
              onDelete={(): void => { void deleteResearch(research.id); }}
            />
          ))}

          {hasMore ? (
            <button
              onClick={(): void => { void loadMore(); }}
              className="w-full py-3 border rounded text-gray-600 hover:bg-gray-50"
            >
              Load More
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface ResearchCardProps {
  research: Research;
  onDelete: () => void;
}

function ResearchCard({ research, onDelete }: ResearchCardProps): JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const status = STATUS_STYLES[research.status];

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="border rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex justify-between items-start">
        <Link to={`/#/research/${research.id}`} className="flex-1">
          <h3 className="font-semibold text-lg hover:text-blue-600">
            {research.title || 'Untitled Research'}
          </h3>
          <p className="text-gray-600 text-sm line-clamp-2 mt-1">
            {research.prompt}
          </p>
        </Link>
        <span className={`${status.bg} ${status.text} px-2 py-1 rounded text-xs ml-4`}>
          {status.label}
        </span>
      </div>

      <div className="flex justify-between items-center mt-4 text-sm text-gray-500">
        <div className="flex gap-4">
          <span>Started: {formatDate(research.startedAt)}</span>
          {research.completedAt !== undefined ? (
            <span>Completed: {formatDate(research.completedAt)}</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {research.selectedLlms.map((llm) => (
            <span key={llm} className="bg-gray-100 px-2 py-0.5 rounded text-xs">
              {llm}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        {showDeleteConfirm ? (
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              className="text-red-600 text-sm hover:underline"
            >
              Confirm Delete
            </button>
            <button
              onClick={(): void => setShowDeleteConfirm(false)}
              className="text-gray-600 text-sm hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={(): void => setShowDeleteConfirm(true)}
            className="text-gray-400 text-sm hover:text-red-600"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
```

---

## Step Checklist

- [ ] Create `ResearchListPage.tsx`
- [ ] Create `ResearchCard` component
- [ ] Implement status badges
- [ ] Implement delete with confirmation
- [ ] Implement load more button
- [ ] Run verification commands

---

## Definition of Done

1. Page lists all researches
2. Status badges displayed correctly
3. Delete works with confirmation
4. Load more pagination works
5. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove `ResearchListPage.tsx`

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
