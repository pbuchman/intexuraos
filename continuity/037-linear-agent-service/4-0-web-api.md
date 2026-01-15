# Task 4-0: Add Linear API Client in Web App

## Tier

4 (Web App)

## Context

Backend integration is complete. Now add the frontend API client for Linear operations.

## Problem Statement

Need to create linearApi.ts in the web app services directory for communicating with linear-agent.

## Scope

### In Scope

- Create `apps/web/src/services/linearApi.ts`
- Add types for Linear API responses
- Add Linear URL to config

### Out of Scope

- UI components (next tasks)
- Routing

## Required Approach

1. **Study** `apps/web/src/services/calendarApi.ts`
2. **Create** linearApi.ts with same patterns
3. **Update** config to include linear-agent URL

## Step Checklist

- [ ] Add `linearAgentUrl` to `apps/web/src/config.ts`
- [ ] Create `apps/web/src/types/linear.ts` with Linear types
- [ ] Update `apps/web/src/types/index.ts` to export Linear types
- [ ] Create `apps/web/src/services/linearApi.ts`
- [ ] Export from `apps/web/src/services/index.ts`
- [ ] TypeCheck web app

## Definition of Done

- API client compiles
- Functions match backend endpoints
- Config includes linear-agent URL

## Verification Commands

```bash
cd apps/web
pnpm run typecheck
cd ../..
```

## Rollback Plan

```bash
git checkout apps/web/src/config.ts
rm apps/web/src/services/linearApi.ts
rm apps/web/src/types/linear.ts
```

## Reference Files

- `apps/web/src/services/calendarApi.ts`
- `apps/web/src/config.ts`
- `apps/web/src/types/calendar.ts`

## config.ts changes

Add to Config interface:

```typescript
linearAgentUrl: string;
```

Add to getConfig():

```typescript
linearAgentUrl: getEnvVar('INTEXURAOS_LINEAR_AGENT_URL'),
```

## types/linear.ts

```typescript
/**
 * Linear API types for web app.
 */

export type LinearPriority = 0 | 1 | 2 | 3 | 4;

export type IssueStateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: LinearPriority;
  state: {
    id: string;
    name: string;
    type: IssueStateCategory;
  };
  url: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearConnectionStatus {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupedIssues {
  backlog: LinearIssue[];
  in_progress: LinearIssue[];
  in_review: LinearIssue[];
  done: LinearIssue[];
  archive: LinearIssue[];
}

export interface ListIssuesResponse {
  teamName: string;
  issues: GroupedIssues;
}
```

## services/linearApi.ts

```typescript
/**
 * Linear Agent API client.
 */

import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { LinearConnectionStatus, LinearTeam, ListIssuesResponse } from '@/types';

// Connection management
export async function getLinearConnection(
  accessToken: string
): Promise<LinearConnectionStatus | null> {
  const response = await apiRequest<{ data: LinearConnectionStatus | null }>(
    config.linearAgentUrl,
    '/linear/connection',
    accessToken
  );
  return response.data;
}

export async function validateLinearApiKey(
  accessToken: string,
  apiKey: string
): Promise<LinearTeam[]> {
  const response = await apiRequest<{ data: { teams: LinearTeam[] } }>(
    config.linearAgentUrl,
    '/linear/connection/validate',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }
  );
  return response.data.teams;
}

export async function saveLinearConnection(
  accessToken: string,
  apiKey: string,
  teamId: string,
  teamName: string
): Promise<LinearConnectionStatus> {
  const response = await apiRequest<{ data: LinearConnectionStatus }>(
    config.linearAgentUrl,
    '/linear/connection',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ apiKey, teamId, teamName }),
    }
  );
  return response.data;
}

export async function disconnectLinear(accessToken: string): Promise<LinearConnectionStatus> {
  const response = await apiRequest<{ data: LinearConnectionStatus }>(
    config.linearAgentUrl,
    '/linear/connection',
    accessToken,
    { method: 'DELETE' }
  );
  return response.data;
}

// Issues
export async function listLinearIssues(
  accessToken: string,
  includeArchive = true
): Promise<ListIssuesResponse> {
  const query = includeArchive ? '' : '?includeArchive=false';
  const response = await apiRequest<{ data: ListIssuesResponse }>(
    config.linearAgentUrl,
    `/linear/issues${query}`,
    accessToken
  );
  return response.data;
}
```

## Update types/index.ts

Add export:

```typescript
export * from './linear.js';
```

## Update services/index.ts

Add export:

```typescript
export * from './linearApi.js';
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
