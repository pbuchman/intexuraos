# Linear Integration Design - Separation of Concerns

**Date:** 2025-02-08
**Status:** Design Document

## Architecture Principles

### 1. Collection Ownership

```
linear_issues collection  →  OWNED BY linear-agent ✅
code_tasks collection     →  OWNED BY code-agent ✅
```

**Rule:** code-agent stores ONLY a reference to Linear issues, never duplicates data.

### 2. Data Flow

```
Linear API → Webhook → linear-agent → Firestore (linear_issues)
                                                ↓
                                    [API Gateway]
                                                ↓
code-agent ← HTTP call to linear-agent API
                                                ↓
                              code_tasks.linearIssueId: "INT-123"
                                                ↓
                                      Web UI (watch & fetch)
```

## Current State Analysis

### ✅ What Works

**linear-agent:**

1. Webhook receiver (`/linear/webhook`)
2. Syncs to `linear_issues` collection
3. Has all data: status, labels, assignee, basic issue info
4. Provides validation API

**code-agent:**

1. Creates code tasks with Linear reference
2. Can search issues via linear-agent (new task UI works!)
3. Stores minimal Linear data (id, title, type from LLM)

**Web UI:**

1. Displays code tasks
2. Shows task logs
3. Shows PR links

### ❌ What's Broken

**linear-agent:**

1. ❌ No comments sync (webhook doesn't store comments)
2. ❌ No API endpoint to fetch full issue by identifier
3. ❌ No subscribe/query for watching issue changes

**code-agent:**

1. ❌ Stores duplicate Linear data (violates ownership)
   - `linearIssueTitle`
   - `linearIssueType` (LLM classification - ok to keep)
   - Should only store `linearIssueId`

**Web UI:**

1. ❌ No Linear context display (status, labels, assignee)
2. ❌ No real-time updates for Linear data changes
3. ❌ No comments display

## Design Solution

### Phase 1: linear-agent Enhancements

#### 1.1 Add Comments Sync to Webhooks

**File:** `apps/linear-agent/src/routes/linearWebhookRoutes.ts`

**New webhook types to handle:**

- `Comment.created`
- `Comment.updated`
- `Comment.removed`

**Implementation:**

```typescript
// Handle Comment events
if (type === 'Comment') {
  await syncCommentFromWebhook(event, userId, services);
  return reply.ok({ message: 'Comment synced' });
}
```

**New collection:** `linear_issue_comments`

```typescript
{
  id: string,              // Comment UUID
  issueId: string,         // Linear issue UUID
  issueIdentifier: string, // "INT-123" (for queries)
  userId: string,
  userName: string,
  body: string,
  createdAt: string,
  updatedAt: string,
  syncedAt: string
}
```

#### 1.2 Add Get Issue API Endpoint

**File:** `apps/linear-agent/src/routes/internalIssuesRoutes.ts` (or new file)

**New endpoint:** `GET /linear/issues/:identifier`

**Response:**

```typescript
{
  success: true,
  data: {
    id: string,
    identifier: string,  // "INT-123"
    title: string,
    description: string,
    state: {
      id: string,
      name: string,      // "Backlog", "Todo", "In Progress"
      type: string       // "backlog", "unstarted", "started", "completed"
    },
    priority: number,
    assignee: {
      id: string,
      name: string
    } | null,
    labels: {
      id: string,
      name: string,
      color: string      // Linear label color
    }[],
    url: string,
    createdAt: string,
    updatedAt: string,
    commentCount: number  // From comments collection
  }
}
```

**Implementation:**

```typescript
async function getIssueByIdentifier(
  request: FastifyRequest<{ Params: { identifier: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const { identifier } = request.params;
  const services = getServices();

  // 1. Fetch from Firestore (already synced via webhook)
  const issueResult = await services.issueRepository.findByIdentifier(identifier);

  if (!issueResult.ok || issueResult.value === null) {
    // 2. Fallback: fetch from Linear API
    const client = await getLinearClient(request.userId);
    const issue = await client.issue(identifier);

    // 3. Sync to Firestore
    await services.issueRepository.save(mapApiIssueToSyncedIssue(issue, request.userId));

    return reply.ok(mapApiIssueToResponse(issue));
  }

  // 4. Add comment count
  const commentsResult = await services.commentRepository.countByIssueId(issueResult.value.id);

  return reply.ok({
    ...issueResult.value,
    commentCount: commentsResult.value ?? 0,
  });
}
```

#### 1.3 Comment Repository

**File:** `apps/linear-agent/src/infra/firestore/linearCommentRepository.ts` (new)

```typescript
interface LinearComment {
  id: string;
  issueId: string;
  issueIdentifier: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
}

interface LinearCommentRepository {
  save(comment: LinearComment): Promise<Result<void, Error>>;
  listByIssueId(issueId: string): Promise<Result<LinearComment[], Error>>;
  countByIssueId(issueId: string): Promise<Result<number, Error>>;
  deleteById(id: string): Promise<Result<void, Error>>;
}
```

### Phase 2: code-agent Cleanup

#### 2.1 Remove Duplicate Linear Data from Firestore Schema

**File:** `apps/code-agent/src/domain/models/codeTask.ts`

**Current (WRONG):**

```typescript
interface CodeTask {
  linearIssueId?: string;
  linearIssueTitle?: string; // ❌ DELETE
  linearIssueType?: string; // ✅ KEEP (LLM classification, not Linear data)
  linearFallback?: boolean;
  // ... other fields
}
```

**After (CORRECT):**

```typescript
interface CodeTask {
  linearIssueId?: string; // ✅ KEEP (reference only)
  linearIssueType?: string; // ✅ KEEP (LLM classification: "feature" | "bug")
  // ❌ Remove: linearIssueTitle, linearIssueStatus, linearIssueLabels, etc.
  // ... other fields
}
```

**Rationale:**

- `linearIssueId` = reference to issue owned by linear-agent
- `linearIssueType` = LLM's classification of task type (not Linear's data)
- Everything else = fetch from linear-agent API

#### 2.2 Update API Response to Fetch from linear-agent

**File:** `apps/code-agent/src/routes/codeTasks.ts`

**Endpoint:** `GET /code/tasks/:id`

**Current response:**

```typescript
{
  success: true,
  data: {
    id: string,
    linearIssueId?: string,
    linearIssueTitle?: string,  // ❌ REMOVE
    linearIssueType?: string,   // ✅ KEEP
    // ... other fields
  }
}
```

**New response:**

```typescript
{
  success: true,
  data: {
    id: string,
    linearIssueId?: string,
    linearIssueType?: string,   // ✅ KEEP (LLM classification)
    linearIssue?: {             // ✅ NEW (fetch from linear-agent)
      identifier: string,
      title: string,
      state: {
        name: string,
        type: string
      },
      labels: Array<{
        id: string,
        name: string,
        color: string
      }>,
      assignee: {
        id: string,
        name: string
      } | null,
      url: string,
      commentCount: number
    },
    // ... other fields
  }
}
```

**Implementation:**

```typescript
async function getCodeTask(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<unknown> {
  const { id } = request.params;
  const services = getServices();

  // Fetch code task
  const taskResult = await services.taskRepository.findById(id);
  if (!taskResult.ok || taskResult.value === null) {
    return reply.fail('NOT_FOUND', 'Task not found');
  }

  const task = taskResult.value;

  // If task has Linear issue, fetch data from linear-agent
  let linearIssue = null;
  if (task.linearIssueId !== undefined) {
    try {
      const linearResponse = await fetch(
        `${config.linearAgentUrl}/linear/issues/${task.linearIssueId}`,
        {
          headers: {
            Authorization: request.headers.authorization,
            'Content-Type': 'application/json',
          },
        }
      );

      if (linearResponse.ok) {
        const linearData = await linearResponse.json();
        linearIssue = linearData.data;
      }
    } catch (error) {
      request.log.warn(
        { error, linearIssueId: task.linearIssueId },
        'Failed to fetch Linear issue data'
      );
    }
  }

  return reply.ok({
    ...task,
    linearIssue, // Add fetched Linear data to response
  });
}
```

#### 2.3 Webhook Handler for Linear Updates

**New endpoint:** `POST /webhook/linear` (internal endpoint for linear-agent)

**Purpose:** Receive webhooks from linear-agent about issue updates

**Implementation:**

```typescript
async function handleLinearWebhook(
  request: FastifyRequest<{ Body: LinearWebhookPayload }>,
  reply: FastifyReply
): Promise<unknown> {
  const { data } = request.body;

  // Find all code tasks referencing this Linear issue
  const tasksResult = await services.taskRepository.findByLinearIssueId(data.identifier);

  if (!tasksResult.ok) {
    return reply.fail('INTERNAL_ERROR', 'Failed to query tasks');
  }

  const tasks = tasksResult.value;

  // Trigger realtime update for each task
  // (Firebase SDK will auto-update connected clients)
  request.log.info(
    { issueIdentifier: data.identifier, taskCount: tasks.length },
    'Linear issue updated, notifying code tasks'
  );

  return reply.ok({
    message: 'Webhook processed',
    notifiedTasks: tasks.length,
  });
}
```

**Note:** We don't need to update anything in code_tasks! The Web UI will refetch from linear-agent API when it detects the task was updated.

### Phase 3: Web UI Updates

#### 3.1 Watch for Task Updates

**File:** `apps/web/src/pages/CodeTaskDetailPage.tsx`

**Current:** Uses `useCodeTask()` hook which watches Firestore

**Already implemented:** The hook uses Firestore `onSnapshot()` for real-time updates!

**What needs to change:**

- When task document updates, refresh linear-agent API call
- Display new Linear data (status, labels, assignee)

#### 3.2 Display Linear Context

**File:** `apps/web/src/pages/CodeTaskDetailPage.tsx`

**Add to links section:**

```typescript
{task.linearIssue !== undefined ? (
  <div className="flex items-center gap-2 mb-2">
    <span className={`px-2 py-1 rounded text-xs font-medium ${
      getStatusColor(task.linearIssue.state.type)
    }`}>
      {task.linearIssue.state.name}
    </span>
    {task.linearIssue.labels.map(label => (
      <span
        key={label.id}
        className="px-2 py-1 rounded text-xs font-medium"
        style={{ backgroundColor: label.color + '20', color: label.color }}
      >
        {label.name}
      </span>
    ))}
    {task.linearIssue.assignee !== null ? (
      <div className="flex items-center gap-1">
        <UserAvatar name={task.linearIssue.assignee.name} />
        <span className="text-xs">{task.linearIssue.assignee.name}</span>
      </div>
    ) : null}
  </div>
) : null}
```

#### 3.3 Comments Section (Future)

**Add after Task Instructions:**

```typescript
{task.linearIssue?.commentCount > 0 ? (
  <Card title={`Comments (${task.linearIssue.commentCount})`}>
    {/* Fetch comments from linear-agent API */}
    <LinearComments issueId={task.linearIssueId} />
  </Card>
) : null}
```

### Phase 4: linear-agent → code-agent Webhook Forwarding

**Problem:** When Linear issue updates via webhook, how does code-agent know?

**Solution A: Query by linearIssueId (Simple)**

```typescript
// Web UI already watches code_tasks document
// When task updatedAt changes, refetch from linear-agent API
```

**Solution B: Webhook forwarding (Real-time)**

```typescript
// linear-agent webhook handler
// After saving to linear_issues:
await forwardToCodeAgent({
  type: 'Issue.updated',
  data: { identifier: 'INT-123' },
});
```

**Recommendation:** Start with Solution A (simpler), add Solution B if needed for real-time requirements.

## Implementation Order

### Sprint 1: Foundation (1 day)

1. ✅ Add comment sync to linear-agent webhooks
2. ✅ Create `linear_issue_comments` collection
3. ✅ Add `GET /linear/issues/:identifier` endpoint

### Sprint 2: Code-agent Cleanup (0.5 day)

1. ✅ Remove duplicate Linear fields from code_tasks
2. ✅ Update API to fetch from linear-agent
3. ✅ Add `linearIssue` field to API response

### Sprint 3: Web UI (1 day)

1. ✅ Update CodeTaskDetailPage types
2. ✅ Display status, labels, assignee
3. ✅ Add color-coded badges
4. ✅ Test real-time updates

### Sprint 4: Comments UI (0.5 day)

1. ✅ Add comments fetch API
2. ✅ Display comments section
3. ✅ Auto-refresh on new comments

## Testing Strategy

### Unit Tests

**linear-agent:**

- ✅ Comment sync from webhook
- ✅ Get issue API returns all fields
- ✅ Comment count calculation

**code-agent:**

- ✅ Task repository only stores linearIssueId
- ✅ API fetches from linear-agent
- ✅ Webhook handler doesn't modify tasks

**Web UI:**

- ✅ Renders Linear context
- ✅ Shows loading state for Linear data
- ✅ Handles fetch errors gracefully

### Integration Tests

**End-to-end:**

1. Create issue in Linear → webhook → linear-agent
2. Fetch issue via API → returns all fields
3. Create code task → stores only linearIssueId
4. Get code task → includes linearIssue from API
5. Update issue in Linear → webhook → Web UI updates

### Manual Testing

**Test scenarios:**

1. Create code task with new Linear issue
2. Update issue status in Linear → verify UI updates
3. Add label to issue → verify UI shows label
4. Assign issue → verify UI shows assignee
5. Add comment → verify UI shows comment count

## Data Model Summary

### linear-agent Collections (OWNER)

**linear_issues:**

```typescript
{
  id: string,              // Linear UUID (doc ID)
  identifier: string,      // "INT-123"
  title: string,
  description: string,
  state: string,           // "In Progress"
  stateType: string,       // "started"
  priority: number,
  assigneeId: string | null,
  assigneeName: string | null,
  labels: string[],        // ["bug", "urgent"]
  url: string,
  userId: string,
  createdAt: string,
  updatedAt: string,
  syncedAt: string
}
```

**linear_issue_comments:**

```typescript
{
  id: string,
  issueId: string,
  issueIdentifier: string, // "INT-123"
  userId: string,
  userName: string,
  body: string,
  createdAt: string,
  updatedAt: string,
  syncedAt: string
}
```

### code-agent Collections (OWNER)

**code_tasks:**

```typescript
{
  id: string,
  linearIssueId?: string,  // "INT-123" (reference only)
  linearIssueType?: string, // "feature" | "bug" (LLM classification)
  // ❌ NO OTHER LINEAR FIELDS
  prompt: string,
  status: string,
  result?: {...},
  error?: {...},
  // ... other code-task specific fields
}
```

## API Contracts

### linear-agent API

**GET /linear/issues/:identifier**

```typescript
Request:
  Headers: { Authorization: string }

Response:
  200: {
    success: true,
    data: {
      id: string,
      identifier: string,
      title: string,
      state: { name: string, type: string },
      labels: [{ id: string, name: string, color: string }],
      assignee: { id: string, name: string } | null,
      url: string,
      commentCount: number
    }
  }
```

**GET /linear/issues/:identifier/comments**

```typescript
Request:
  Headers: { Authorization: string }

Response:
  200: {
    success: true,
    data: [{
      id: string,
      userName: string,
      body: string,
      createdAt: string
    }]
  }
```

### code-agent API

**GET /code/tasks/:id**

```typescript
Response:
  200: {
    success: true,
    data: {
      id: string,
      linearIssueId?: string,
      linearIssueType?: string,
      linearIssue?: {  // Fetched from linear-agent
        identifier: string,
        title: string,
        state: { name: string, type: string },
        labels: Array<{ id: string, name: string, color: string }>,
        assignee: { id: string, name: string } | null,
        url: string,
        commentCount: number
      },
      // ... other code-task fields
    }
  }
```

## Migration Plan

### Step 1: Backend Deploy (no downtime)

1. Deploy linear-agent with new endpoints
2. Deploy code-agent with updated API

### Step 2: Data Cleanup (one-time migration)

```bash
# Remove duplicate Linear fields from code_tasks
firebase firestore:delete --collection code_tasks --field linearIssueTitle
firebase firestore:delete --collection code_tasks --field linearIssueStatus
# etc.
```

### Step 3: Web UI Deploy

1. Deploy new Web UI
2. Verify Linear context displays
3. Test real-time updates

## Success Criteria

✅ linear-agent syncs all Linear data including comments
✅ linear-agent provides API to fetch issue by identifier
✅ code-agent stores ONLY linearIssueId reference
✅ code-agent API fetches from linear-agent on demand
✅ Web UI displays status, labels, assignee
✅ Web UI updates when Linear issue changes
✅ No duplicate Linear data in code_tasks collection
✅ Collection ownership boundaries respected

## References

- Linear webhook docs: https://developers.linear.com/docs/webhooks
- @linear/sdk: https://www.npmjs.com/package/@linear/sdk
- Firestore collection ownership pattern (internal doc)
