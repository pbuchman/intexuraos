# Linear API Endpoints - Gap Analysis

**Date:** 2025-02-08
**Status:** Ready for Implementation

## Existing Endpoints

### User API (with user authentication)

**Connection Management:**

- ✅ `GET /linear/connection` - Get connection status
- ✅ `POST /linear/connection/validate` - Validate API key and get teams
- ✅ `POST /linear/connection` - Save connection
- ✅ `DELETE /linear/connection` - Disconnect
- ✅ `GET /linear/webhook-config` - Get webhook URL/secret status
- ✅ `POST /linear/webhook-config` - Set webhook secret
- ✅ `DELETE /linear/webhook-config` - Remove webhook secret

**Issue Management:**

- ✅ `GET /linear/issues` - List all issues (grouped for dashboard)
- ✅ `POST /linear/sync` - Trigger full sync

**Failed Extractions:**

- ✅ `GET /linear/failed-issues` - List failed extractions
- ✅ `DELETE /linear/failed-issues/:id` - Delete failed issue
- ✅ `POST /linear/failed-issues/:id/retry` - Retry creating issue

### Internal API (with internal auth token)

**Action Processing:**

- ✅ `POST /internal/linear/process-action` - Process action from natural language
- ✅ `POST /internal/linear/issues/generate-title` - Generate title from description
- ✅ `POST /internal/linear/sync` - Trigger full sync

**Issue Validation:**

- ✅ `GET /internal/linear/issues/:identifier` - **VALIDATE ISSUE**
  - **Current response:** `{ id, identifier, title, url, labels[], childCount }`
  - **Auth:** `X-Internal-Auth` header
  - **Query:** `?userId=...` (for team validation)

## What's Missing

### For Web UI (User API) ❌

**MISSING:** `GET /linear/issues/:identifier`

**Purpose:** Fetch single issue with full context for display

**Should return:**

```typescript
{
  success: true,
  data: {
    id: string,              // Linear UUID
    identifier: string,      // "INT-123"
    title: string,
    description: string,
    state: {
      id: string,
      name: string,          // "In Progress", "Backlog", etc.
      type: string           // "started", "backlog", etc.
    },
    priority: number,        // 0-4
    assignee: {
      id: string,
      name: string,
      avatarUrl?: string
    } | null,
    labels: {
      id: string,
      name: string,
      color: string          // ← IMPORTANT for UI!
    }[],
    url: string,
    createdAt: string,
    updatedAt: string
  }
}
```

**Implementation:**

- Fetch from `linear_issues` Firestore collection (already synced via webhook)
- Fallback to Linear API if not in cache
- Use `@linear/sdk` to get label colors

### For code-agent (Internal API) ❌

**EXISTS BUT INCOMPLETE:** `GET /internal/linear/issues/:identifier`

**Current response (INCOMPLETE):**

```typescript
{
  id: string,
  identifier: string,
  title: string,
  url: string,
  labels: string[],         // ← Only names, no colors
  childCount: number
}
```

**MISSING fields:**

- ❌ `state` - Current status name and type
- ❌ `assignee` - Who owns the issue
- ❌ `priority` - Issue priority
- ❌ `description` - Issue description
- ❌ `createdAt`, `updatedAt` - Timestamps

**Enhanced response needed:**

```typescript
{
  id: string,
  identifier: string,
  title: string,
  description: string,
  state: {
    id: string,
    name: string,          // "In Progress"
    type: string           // "started"
  },
  priority: number,
  assignee: {
    id: string,
    name: string
  } | null,
  labels: {               // ← ENHANCED to include color
    id: string,
    name: string,
    color: string
  }[],
  url: string,
  childCount: number,
  createdAt: string,
  updatedAt: string
}
```

## Implementation Plan

### Sprint 1: linear-agent Backend (2 hours)

#### 1.1 Create comment webhook sync

**File:** `apps/linear-agent/src/domain/useCases/syncCommentFromWebhook.ts` (new)

```typescript
export async function syncCommentFromWebhook(
  event: LinearCommentWebhookEvent,
  userId: string,
  deps: SyncCommentDeps
): Promise<Result<void, LinearError>> {
  const comment: LinearComment = {
    id: event.data.comment.id,
    issueId: event.data.issueId,
    issueIdentifier: event.data.issueIdentifier,
    userId: event.data.comment.userId,
    userName: event.data.comment.userName,
    body: event.data.comment.body,
    createdAt: event.data.comment.createdAt,
    updatedAt: event.data.comment.updatedAt,
    syncedAt: new Date().toISOString(),
  };

  return await deps.commentRepository.save(comment);
}
```

**File:** `apps/linear-agent/src/infra/firestore/linearCommentRepository.ts` (new)

```typescript
export interface LinearComment {
  id: string;
  issueId: string; // Linear UUID
  issueIdentifier: string; // "INT-123"
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
}

interface LinearCommentRepository {
  save(comment: LinearComment): Promise<Result<void, Error>>;
  countByIssueId(issueId: string): Promise<Result<number, Error>>;
}
```

**File:** `apps/linear-agent/src/routes/linearWebhookRoutes.ts`

Add to webhook handler:

```typescript
// Handle Comment events
if (type === 'Comment') {
  await syncCommentFromWebhook(event, userId, services);
  return reply.ok({ message: 'Comment synced' });
}
```

#### 1.2 Add user-facing GET issue endpoint

**File:** `apps/linear-agent/src/routes/linearRoutes.ts`

**Add new endpoint:**

```typescript
fastify.get<{ Params: { identifier: string } }>(
  '/linear/issues/:identifier',
  {
    schema: {
      operationId: 'getIssueByIdentifier',
      summary: 'Get a single Linear issue by identifier',
      description: 'Returns full issue data including status, labels, assignee',
      tags: ['linear'],
      params: {
        type: 'object',
        required: ['identifier'],
        properties: {
          identifier: { type: 'string', description: 'Issue identifier (e.g., INT-123)' },
        },
      },
      response: {
        /* ... */
      },
    },
  },
  async (request: FastifyRequest<{ Params: { identifier: string } }>, reply: FastifyReply) => {
    logIncomingRequest(request);
    const user = await requireAuth(request, reply);
    if (user === null) return;

    const { identifier } = request.params;
    const services = getServices();

    // 1. Try Firestore first (fast)
    const issueResult = await services.issueRepository.findByIdentifier(identifier);

    if (issueResult.ok && issueResult.value !== null) {
      // 2. Add comment count
      const countResult = await services.commentRepository.countByIssueId(issueResult.value.id);

      return reply.ok({
        ...issueResult.value,
        commentCount: countResult.value ?? 0,
      });
    }

    // 3. Fallback to Linear API
    const apiKeyResult = await services.connectionRepository.getApiKey(user.userId);
    if (!apiKeyResult.ok || apiKeyResult.value === null) {
      return reply.fail('FORBIDDEN', 'Linear not connected');
    }

    const issue = await services.linearApiClient.fetchIssue(apiKeyResult.value, identifier);
    if (!issue.ok) {
      return reply.fail('NOT_FOUND', 'Issue not found');
    }

    // 4. Sync to Firestore for next time
    const syncedIssue = mapApiIssueToSyncedIssue(issue.value, user.userId);
    await services.issueRepository.save(syncedIssue);

    return reply.ok(syncedIssue);
  }
);
```

#### 1.3 Enhance internal validate issue endpoint

**File:** `apps/linear-agent/src/domain/useCases/validateIssue.ts`

**Update to return all fields:**

```typescript
// Current: returns { id, identifier, title, url, labels[], childCount }
// Enhanced: returns { id, identifier, title, description, state, priority, assignee, labels[], url, childCount }
```

**File:** `apps/linear-agent/src/infra/linear/linearApiClient.ts`

**Add new function:**

```typescript
export async function fetchIssue(
  apiKey: string,
  identifier: string
): Promise<Result<LinearIssueWithFullDetails, LinearError>> {
  const client = getOrCreateClient(apiKey);

  const issue = await client.issue(identifier);
  if (!issue) {
    return err({ code: 'NOT_FOUND', message: 'Issue not found' });
  }

  const state = await issue.state;
  const assignee = await issue.assignee;
  const labels = await issue.labels();

  return ok({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    state: {
      id: state?.id ?? '',
      name: state?.name ?? 'Unknown',
      type: mapIssueStateType(state?.type ?? 'backlog'),
    },
    priority: issue.priority as 0 | 1 | 2 | 3 | 4,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    labels: labels.nodes.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    url: issue.url,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  });
}
```

### Sprint 2: code-agent Integration (1 hour)

#### 2.1 Update CodeTask API response

**File:** `apps/code-agent/src/routes/codeTasks.ts`

**Current:** Returns task with `linearIssueId`, `linearIssueTitle`, `linearIssueType`

**New:**

```typescript
async function handleGetTask(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const task = await fetchTask(request.params.id, request);

  let linearIssue = null;
  if (task.linearIssueId !== undefined) {
    // Fetch from linear-agent internal API
    const response = await fetch(
      `${config.linearAgentUrl}/internal/linear/issues/${task.linearIssueId}?userId=${task.userId}`,
      {
        headers: {
          'X-Internal-Auth': config.internalAuthToken,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      linearIssue = data.data;
    }
  }

  return reply.ok({
    ...task,
    linearIssue,
  });
}
```

#### 2.2 Remove duplicate Linear fields from code_tasks

**File:** `apps/code-agent/src/domain/models/codeTask.ts`

**Remove:**

- `linearIssueTitle` (fetch from linear-agent)
- Keep: `linearIssueId` (reference only)
- Keep: `linearIssueType` (LLM classification, not Linear data)

### Sprint 3: Web UI (2 hours)

#### 3.1 Update TypeScript types

**File:** `apps/web/src/types/index.ts`

```typescript
export interface CodeTask {
  // ... existing fields

  // ✅ KEEP (reference only)
  linearIssueId?: string;
  linearIssueType?: 'feature' | 'bug' | 'refactor' | 'research';

  // ❌ DELETE (fetch from linear-agent API)
  // linearIssueTitle?: string;

  // ✅ NEW (fetched from linear-agent)
  linearIssue?: {
    identifier: string;
    title: string;
    description: string;
    state: {
      id: string;
      name: string;
      type: string;
    };
    priority: number;
    assignee: {
      id: string;
      name: string;
    } | null;
    labels: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    url: string;
    commentCount: number;
  };
}
```

#### 3.2 Update CodeTaskDetailPage UI

**Display status badge:**

```typescript
{task.linearIssue && (
  <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(task.linearIssue.state.type)}`}>
    {task.linearIssue.state.name}
  </span>
)}
```

**Display labels:**

```typescript
{task.linearIssue?.labels.map(label => (
  <span
    key={label.id}
    className="px-2 py-1 rounded text-xs font-medium"
    style={{ backgroundColor: label.color + '20', color: label.color }}
  >
    {label.name}
  </span>
))}
```

**Display assignee:**

```typescript
{task.linearIssue?.assignee && (
  <div className="flex items-center gap-1">
    <UserAvatar name={task.linearIssue.assignee.name} />
    <span className="text-sm">{task.linearIssue.assignee.name}</span>
  </div>
)}
```

#### 3.3 Real-time updates

**Already implemented:** `useCodeTask()` hook uses Firestore `onSnapshot()`!

**Just need to:** When `task.updatedAt` changes, the hook will auto-refresh, which will refetch from linear-agent API.

## Webhook Events to Handle

### Already Working:

- ✅ `Issue.create` - Creates new issue in Firestore
- ✅ `Issue.update` - Updates existing issue in Firestore

### Need to Add:

- ✅ `Comment.created` - Create comment record
- ✅ `Comment.updated` - Update comment
- ✅ `Comment.removed` - Delete comment

### Ignored (not needed):

- ❌ `Label.*` - Labels come with Issue.update payload
- ❌ `State.*` - State changes come with Issue.update payload

## Test Coverage

### Unit Tests

**linear-agent:**

- [ ] Comment sync from webhook
- [ ] Get issue by identifier (Firestore)
- [ ] Get issue by identifier (Linear API fallback)
- [ ] Enhanced validate issue returns all fields

**code-agent:**

- [ ] Code task API fetches from linear-agent
- [ ] Code task API returns linearIssue field
- [ ] Handles linear-agent errors gracefully

**Web UI:**

- [ ] Displays Linear context in CodeTaskDetailPage
- [ ] Shows status badge with correct color
- [ ] Shows labels with correct colors
- [ ] Shows assignee
- [ ] Real-time updates when Linear issue changes

### Integration Tests

[ ] End-to-end: Linear webhook → linear-agent → code-agent → Web UI
[ ] Issue status update reflects in Web UI
[ ] Issue label addition reflects in Web UI
[ ] Issue assignment reflects in Web UI
[ ] Comment addition increments comment count

## API Contract Summary

### NEW: User API

```
GET /linear/issues/:identifier

Response:
{
  success: true,
  data: {
    id: string,
    identifier: "INT-123",
    title: string,
    description: string,
    state: {
      id: string,
      name: "In Progress",
      type: "started"
    },
    priority: 3,
    assignee: { id: string, name: string } | null,
    labels: [{ id: string, name: "bug", color: "#ff0000" }],
    url: string,
    commentCount: 5
  }
}
```

### ENHANCED: Internal API

```
GET /internal/linear/issues/:identifier?userId=...

Current: { id, identifier, title, url, labels[], childCount }

Enhanced:
{
  id: string,
  identifier: string,
  title: string,
  description: string,
  state: { id, name, type },
  priority: number,
  assignee: { id, name } | null,
  labels: [{ id, name, color }],
  url: string,
  childCount: number,
  createdAt: string,
  updatedAt: string
}
```

### UPDATED: code-agent API

```
GET /code/tasks/:id

Current:
{
  linearIssueId?: "INT-123",
  linearIssueTitle?: "Title",         ← REMOVE
  linearIssueType?: "feature",        ← KEEP (LLM classification)
  // ... other fields
}

New:
{
  linearIssueId?: "INT-123",            ← KEEP (reference)
  linearIssueType?: "feature",         ← KEEP (LLM classification)
  linearIssue?: {                       ← NEW (fetched from linear-agent)
    identifier: "INT-123",
    title: "Title",
    state: { name: "In Progress", type: "started" },
    assignee: { id: "...", name: "John" } | null,
    labels: [{ id: "...", name: "bug", color: "#f00" }],
    commentCount: 5
  }
}
```

## Priority Order

1. **P0:** Add comment webhook sync (1h)
   - Create comment repository
   - Handle Comment.\* webhook events
   - Verify comments stored in Firestore

2. **P0:** Add user-facing GET issue endpoint (1h)
   - Fetch from Firestore
   - Add comment count
   - Fallback to Linear API

3. **P1:** Enhance internal validate issue (0.5h)
   - Add missing fields to response
   - Update use case

4. **P1:** Update code-agent API (0.5h)
   - Fetch from linear-agent
   - Add linearIssue to response

5. **P2:** Remove duplicate Linear fields (0.5h)
   - Remove from code_tasks schema
   - Update migration docs

6. **P2:** Update Web UI (1.5h)
   - Display status, labels, assignee
   - Real-time updates
   - Error handling

**Total:** ~5 hours

## Next Steps

1. ✅ Gap analysis complete
2. ⏳ Implement comment webhook sync
3. ⏳ Add GET /linear/issues/:identifier endpoint
4. ⏳ Enhance internal validate issue endpoint
5. ⏳ Update code-agent to fetch from linear-agent
6. ⏳ Update Web UI to display Linear context
7. ⏳ Test end-to-end flow
