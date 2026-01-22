# Task 1-5: Implement List Issues Use Case

## Tier

1 (Independent Deliverables)

## Context

Create issue use case is complete. Now implement the list issues use case for the dashboard.

## Problem Statement

Need to implement `listIssues` use case that:

1. Fetches issues from Linear API
2. Groups by dashboard column (backlog, in_progress, in_review, done)
3. Filters done issues to last 7 days + archive

## Scope

### In Scope

- `listIssues` use case
- Group issues by dashboard column
- Filter done column by date
- Return grouped structure for frontend

### Out of Scope

- HTTP routing (next tier)
- Caching (can add later)

## Required Approach

1. **Study** domain models for dashboard columns
2. **Implement** use case fetching and grouping
3. **Apply** date filter for done column
4. **Write tests**

## Step Checklist

- [ ] Create `apps/linear-agent/src/domain/useCases/listIssues.ts`
- [ ] Implement grouping by dashboard column
- [ ] Implement date filtering for done issues
- [ ] Create tests
- [ ] Export from domain/index.ts

## Definition of Done

- Use case returns properly grouped issues
- Done column filtered correctly
- Tests pass
- TypeScript compiles

## Verification Commands

```bash
cd apps/linear-agent
pnpm run typecheck
pnpm vitest run src/__tests__/domain/useCases/listIssues.test.ts
cd ../..
```

## Rollback Plan

```bash
rm apps/linear-agent/src/domain/useCases/listIssues.ts
```

## domain/useCases/listIssues.ts

```typescript
/**
 * List Issues Use Case
 *
 * Fetches Linear issues and groups them for dashboard display.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearError,
  LinearApiClient,
  LinearConnectionRepository,
  LinearIssue,
  DashboardColumn,
} from '../index.js';
import { mapStateToDashboardColumn } from '../models.js';

export interface ListIssuesDeps {
  linearApiClient: LinearApiClient;
  connectionRepository: LinearConnectionRepository;
  logger?: Logger;
}

export interface ListIssuesRequest {
  userId: string;
  /** Include archived (old completed) issues */
  includeArchive?: boolean;
}

export interface GroupedIssues {
  backlog: LinearIssue[];
  in_progress: LinearIssue[];
  in_review: LinearIssue[];
  done: LinearIssue[];
  archive: LinearIssue[];
}

export interface ListIssuesResponse {
  issues: GroupedIssues;
  teamName: string;
}

const DONE_RECENT_DAYS = 7;

export async function listIssues(
  request: ListIssuesRequest,
  deps: ListIssuesDeps
): Promise<Result<ListIssuesResponse, LinearError>> {
  const { userId, includeArchive = true } = request;
  const { linearApiClient, connectionRepository, logger } = deps;

  logger?.info({ userId, includeArchive }, 'listIssues: entry');

  // Get user's connection
  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    return err(connectionResult.error);
  }

  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'Linear not connected' });
  }

  // Fetch issues - get more days for archive
  const fetchDays = includeArchive ? 30 : DONE_RECENT_DAYS;
  const issuesResult = await linearApiClient.listIssues(connection.apiKey, connection.teamId, {
    completedSinceDays: fetchDays,
  });

  if (!issuesResult.ok) {
    return err(issuesResult.error);
  }

  const issues = issuesResult.value;
  logger?.info({ userId, totalIssues: issues.length }, 'Fetched issues');

  // Group issues by dashboard column
  const grouped: GroupedIssues = {
    backlog: [],
    in_progress: [],
    in_review: [],
    done: [],
    archive: [],
  };

  const now = new Date();
  const recentCutoff = new Date(now);
  recentCutoff.setDate(now.getDate() - DONE_RECENT_DAYS);

  for (const issue of issues) {
    const column = mapStateToDashboardColumn(issue.state.type, issue.state.name);

    if (column === 'done') {
      // Check if issue is recent or archive
      if (issue.completedAt !== null) {
        const completedDate = new Date(issue.completedAt);
        if (completedDate >= recentCutoff) {
          grouped.done.push(issue);
        } else if (includeArchive) {
          grouped.archive.push(issue);
        }
      } else {
        // No completedAt but in done state - treat as recent
        grouped.done.push(issue);
      }
    } else {
      grouped[column].push(issue);
    }
  }

  // Sort each column by updatedAt (most recent first)
  const sortByUpdated = (a: LinearIssue, b: LinearIssue): number =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

  grouped.backlog.sort(sortByUpdated);
  grouped.in_progress.sort(sortByUpdated);
  grouped.in_review.sort(sortByUpdated);
  grouped.done.sort(sortByUpdated);
  grouped.archive.sort(sortByUpdated);

  logger?.info(
    {
      userId,
      backlog: grouped.backlog.length,
      in_progress: grouped.in_progress.length,
      in_review: grouped.in_review.length,
      done: grouped.done.length,
      archive: grouped.archive.length,
    },
    'Issues grouped by column'
  );

  return ok({
    issues: grouped,
    teamName: connection.teamName,
  });
}
```

## Update domain/index.ts

Add export:

```typescript
export {
  listIssues,
  type ListIssuesDeps,
  type ListIssuesRequest,
  type ListIssuesResponse,
  type GroupedIssues,
} from './useCases/listIssues.js';
```

## Test file structure

Create tests covering:

1. Successfully groups issues by column
2. Recent done issues in done column
3. Old done issues in archive column
4. Archive excluded when includeArchive=false
5. User not connected error
6. API failure error

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
