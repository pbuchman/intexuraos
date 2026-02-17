# Linear Integration Investigation & Data Gaps

**Date:** 2025-02-08
**Status:** Critical Data Loss Bug Identified

## Executive Summary

Linear webhooks ARE working and syncing data to Firestore, BUT **code-agent does NOT fetch or expose** the synced data. Labels, status, assignee, and comments are being lost in the gap between linear-agent and code-agent.

## Current Architecture

```
Linear API → Webhook → linear-agent → Firestore (linear_issues collection)
                                                ↓
                                            [MISSING BRIDGE]
                                                ↓
code-agent ← Should read from linear_issues OR fetch from Linear API
                                                ↓
                                            Firestore (code_tasks collection)
                                                ↓
                                          Web UI
```

## Data Flow Investigation

### 1. Linear Webhook Receiver ✅ WORKS

**File:** `apps/linear-agent/src/routes/linearWebhookRoutes.ts`

**Events Handled:**

- `Issue.create` - New issue created
- `Issue.update` - Issue updated (status, labels, assignee, comments)
- `Issue.remove` - Issue deleted

**Data Received from Linear:**

```typescript
{
  action: 'create' | 'update' | 'remove',
  type: 'Issue',
  data: {
    id: string,              // Linear UUID
    identifier: string,      // "INT-123"
    title: string,
    description: string,
    priority: number,
    state: {
      id: string,
      name: string,          // "Backlog", "Todo", "In Progress", "Done", etc.
      type: string           // "backlog", "unstarted", "started", "completed"
    },
    assignee: {
      id: string,
      name: string           // 👈 ASSIGNEE DATA EXISTS
    } | null,
    labels: {                // 👈 LABELS DATA EXISTS
      id: string,
      name: string           // e.g., "bug", "feature", "urgent"
    }[],
    team: { id, key }
  }
}
```

**Processing:**

1. Validates webhook signature
2. Looks up user connection by team ID
3. Calls `syncSingleIssue()` use case
4. Saves to Firestore (`linear_issues` collection)

### 2. Linear Firestore Sync ✅ WORKS

**File:** `apps/linear-agent/src/infra/firestore/linearIssueRepository.ts`

**Collection:** `linear_issues`

**Schema Synced:**

```typescript
{
  id: string,              // Linear UUID
  identifier: string,      // "INT-123"
  title: string,
  description: string,
  state: string,           // State name
  stateType: IssueStateCategory,  // "backlog" | "unstarted" | "started" | "completed" | "cancelled"
  priority: 0 | 1 | 2 | 3 | 4,
  assigneeId: string | null,    // 👈 STORED
  assigneeName: string | null,  // 👈 STORED
  labels: string[],            // 👈 STORED ["bug", "feature"]
  url: string,
  userId: string,
  createdAt: string,
  updatedAt: string,
  syncedAt: string       // Last sync time
}
```

### 3. Linear API Client ✅ WORKS

**File:** `apps/linear-agent/src/infra/linear/linearApiClient.ts`

**SDK:** `@linear/sdk` (official Linear SDK)

**Key Functions:**

- `getIssue()` - Fetch single issue
- `listIssues()` - List issues for team
- `validateIssue()` - Validate issue exists and belongs to team
- `createIssue()` - Create new issue
- `updateIssueState()` - Update state (In Progress, Done, etc.)

**Optimizations:**

- Client caching (5 min TTL)
- Request deduplication (10 sec TTL)
- Batch state fetching

### 4. Code-Agent to Linear-Agent Bridge ❌ BROKEN

**File:** `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`

**Current Behavior:**

```typescript
async validateIssue({ identifier }): Promise<Result<ValidateResult>> {
  // Calls linear-agent internal API
  const response = await fetch(`${config.linearAgentUrl}/linear/issues/validate`, ...)

  // Returns ONLY:
  return {
    id: string,
    identifier: string,
    title: string,
    labels: string[],      // ✅ HAS LABELS
    childCount: number
  }
}
```

**Problem:** code-agent **fetches** labels from linear-agent BUT **doesn't store** them!

### 5. Code-Agent Firestore ❌ DATA LOSS

**File:** `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`

**Current Schema (code_tasks collection):**

```typescript
{
  id: string,
  linearIssueId?: string,        // ✅ "INT-123"
  linearIssueTitle?: string,     // ✅ "Title"
  linearIssueType?: string,      // ✅ "feature" | "bug" | "refactor" | "research"
  linearFallback?: boolean,

  // ❌ MISSING FIELDS:
  // linearIssueStatus?: string           // "Backlog", "Todo", "In Progress", "Done"
  // linearIssueLabels?: string[]        // ["bug", "urgent"]
  // linearIssueAssigneeId?: string      // User ID
  // linearIssueAssigneeName?: string    // User name
  // linearIssueComments?: Comment[]     // Comment history

  result?: CodeTaskResult,
  error?: CodeTaskError,
  // ... other fields
}
```

**Critical Bug:** Service fetches labels (line 96 of linearIssueService.ts) but **never stores** in Firestore!

## Missing Data Fields

| Field        | Linear Webhook | linear-agent Firestore | linear-agent API | code-agent API | code-agent Firestore | Web UI |
| ------------ | -------------- | ---------------------- | ---------------- | -------------- | -------------------- | ------ |
| Issue ID     | ✅             | ✅                     | ✅               | ✅             | ✅                   | ✅     |
| Title        | ✅             | ✅                     | ✅               | ✅             | ✅                   | ✅     |
| Type (LLM)   | -              | -                      | ✅               | ✅             | ✅                   | ✅     |
| **Status**   | ✅             | ✅                     | ✅               | ❌             | ❌                   | ❌     |
| **Labels**   | ✅             | ✅                     | ✅               | ✅             | ❌                   | ❌     |
| **Assignee** | ✅             | ✅                     | ✅               | ❌             | ❌                   | ❌     |
| **Comments** | ✅             | ❌                     | ❌               | ❌             | ❌                   | ❌     |

## Root Causes

### Gap #1: code-agent Doesn't Fetch Full Issue Data

**Current:** code-agent only validates issue exists
**Missing:** Fetch status, labels, assignee from linear-agent API

### Gap #2: Firestore Schema Missing Fields

**Current:** `code_tasks` collection only stores `linearIssueId`, `linearIssueTitle`, `linearIssueType`
**Missing:** `linearIssueStatus`, `linearIssueLabels`, `linearIssueAssigneeId`, `linearIssueAssigneeName`

### Gap #3: linear-agent Doesn't Sync Comments

**Current:** Webhooks don't sync comment history
**Missing:** Comments array in Firestore

### Gap #4: No Polling/Sync for Changed Issues

**Current:** Only webhooks update `linear_issues` collection
**Missing:** If webhook fails, issues become stale

## Implementation Plan

### Phase 1: Backend Data Sync (Critical)

1. **Update Firestore Schema** (code_tasks collection)

   ```typescript
   interface CodeTask {
     // ... existing fields

     // NEW FIELDS:
     linearIssueStatus?: string;
     linearIssueStatusCategory?:
       | 'backlog'
       | 'todo'
       | 'in_progress'
       | 'in_review'
       | 'done'
       | 'canceled';
     linearIssueLabels?: string[];
     linearIssueAssigneeId?: string;
     linearIssueAssigneeName?: string;
     linearIssueCommentCount?: number;
     linearIssueLastCommentAt?: string;
   }
   ```

2. **Update linear-agent API** to return full issue data
   - Add `/linear/issues/:identifier` endpoint
   - Returns: status, labels, assignee (already has from validateIssue)

3. **Update code-agent** to fetch and store
   - After task creation, fetch full issue data
   - Store in Firestore code_tasks document
   - Update when webhook received (see Phase 2)

### Phase 2: Webhook Forwarding (Critical)

1. **linear-agent forwards webhooks to code-agent**
   - New endpoint: `/webhook/forward-to-code-agent`
   - Code-agent subscribes to specific team webhooks
   - When issue updates, forward to code-agent

2. **code-agent webhook handler**
   - Receives issue updates from linear-agent
   - Updates relevant `code_tasks` documents
   - Fields to sync: status, labels, assignee, comment count

### Phase 3: Comments Sync (Future)

1. **Store comments in Firestore**

   ```typescript
   interface LinearIssueComment {
     id: string;
     issueId: string;
     userId: string;
     userName: string;
     body: string;
     createdAt: string;
     updatedAt: string;
   }
   ```

2. **Add comment collection**
   - Collection: `linear_issue_comments`
   - Synced via webhook events (Comment.created, Comment.updated)

### Phase 4: Web UI Updates

1. **Update CodeTaskDetailPage**
   - Display status badge (Backlog/Todo/In Progress/Done)
   - Display labels as colored badges
   - Display assignee avatar/name
   - Add "View on Linear" link with full context

2. **Update CodeTasksPage**
   - Show status in list view
   - Filter by status
   - Show assignee avatar

## Test Coverage Required

### Unit Tests

1. **linear-agent API**
   - `GET /linear/issues/:identifier` returns full issue data
   - Includes status, labels, assignee

2. **code-agent repository**
   - `create()` saves linearIssueStatus, linearIssueLabels, etc.
   - `updateLinearIssueData()` updates from webhook

3. **Webhook forwarding**
   - linear-agent forwards to code-agent
   - code-agent updates code_tasks document

### Integration Tests

1. **End-to-end sync flow**
   - Issue created in Linear → webhook → linear-agent → code-agent → Firestore
   - Issue status updated → webhook → code-agent updates code_tasks

2. **API response contract**
   - Code-agent GET /code/tasks/:id returns all Linear fields
   - Web UI displays all fields

## Priority & Timeline

| Priority | Task                        | Effort | Impact                   |
| -------- | --------------------------- | ------ | ------------------------ |
| P0       | Add Firestore fields        | 2h     | Enables all other work   |
| P0       | Fetch from linear-agent API | 3h     | Data source exists       |
| P0       | Store in code-agent         | 2h     | Fixes data loss          |
| P1       | Webhook forwarding          | 4h     | Real-time sync           |
| P1       | Web UI display              | 3h     | User-visible improvement |
| P2       | Comments sync               | 6h     | Nice-to-have             |
| P2       | Polling fallback            | 3h     | Reliability              |

## Next Steps

1. ✅ Investigation complete
2. ⏳ Create Linear issue for implementation
3. ⏳ Update Firestore schema
4. ⏳ Implement API changes
5. ⏳ Add test coverage
6. ⏳ Update Web UI
7. ⏳ Deploy to production

## References

- Linear webhook documentation: https://developers.linear.com/docs/webhooks
- @linear/sdk: https://www.npmjs.com/package/@linear/sdk
- Design doc: `docs/designs/INT-156-code-action-type.md`
