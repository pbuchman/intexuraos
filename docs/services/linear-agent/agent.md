# linear-agent - Agent Interface

> Machine-readable interface definition for AI agents interacting with linear-agent.

---

## Identity

| Field    | Value                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- |
| **Name** | linear-agent                                                                                            |
| **Role** | Linear Issue Management with AI Extraction, Webhook Sync, and Programmatic Issue Control                |
| **Goal** | Create and manage Linear issues from natural language, sync via webhooks, and serve code agent requests |

---

## Capabilities

### Process Action (Create Issue from Natural Language)

**Endpoint:** `POST /internal/linear/process-action`

**When to use:** When you need to create a Linear issue from natural language input (voice transcription, text command).

**Input Schema:**

```typescript
interface ProcessActionInput {
  action: {
    id: string;      // Unique action ID (for idempotency)
    userId: string;   // User ID
    text: string;     // Natural language description
    summary?: string; // Optional pre-extracted summary
  };
}
```

**Output Schema:**

```typescript
interface ProcessActionOutput {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string;   // Linear issue URL (success only)
  errorCode?: string;     // Error code (failure only)
}
```

**Example:**

```json
// Request
{
  "action": {
    "id": "action-abc-123",
    "userId": "user-xyz-789",
    "text": "Fix the login button on iOS, it's not responding to taps. High priority."
  }
}

// Response (success)
{
  "status": "completed",
  "message": "Issue INT-456 created successfully",
  "resourceUrl": "https://linear.app/team/issue/INT-456"
}

// Response (failure)
{
  "status": "failed",
  "message": "Could not extract meaningful issue details from input",
  "errorCode": "EXTRACTION_FAILED"
}
```

### Create Issue (Programmatic)

**Endpoint:** `POST /internal/issues`

**When to use:** When a code agent needs to create a Linear issue with a specific title and description (no AI extraction needed).

**Auth:** `X-Internal-Auth` header + `X-User-Id` header

**Input Schema:**

```typescript
interface CreateIssueInput {
  title: string;
  description: string;
  labels?: string[];  // Accepted for future use
}
```

**Output Schema:**

```typescript
interface IssueResponse {
  id: string;
  identifier: string;  // e.g., "INT-123"
  title: string;
  url: string;
}
```

**Example:**

```json
// Request
{
  "title": "Implement pagination for user list",
  "description": "Add cursor-based pagination to the GET /users endpoint."
}

// Response
{
  "id": "issue-uuid-789",
  "identifier": "INT-130",
  "title": "Implement pagination for user list",
  "url": "https://linear.app/team/issue/INT-130"
}
```

### Update Issue State

**Endpoint:** `PATCH /internal/issues/:issueId/state`

**When to use:** When a code agent needs to transition an issue through workflow states (e.g., moving to "In Progress" when starting work, or "In Review" when opening a PR).

**Auth:** `X-Internal-Auth` header + `X-User-Id` header

**Input Schema:**

```typescript
interface UpdateStateInput {
  state: 'backlog' | 'in_progress' | 'in_review' | 'qa';
}
```

**State Name Mapping:**

| Input          | Linear State Name |
| -------------- | ----------------- |
| `backlog`      | Backlog           |
| `in_progress`  | In Progress       |
| `in_review`    | In Review         |
| `qa`           | QA                |

**Example:**

```json
// Request: PATCH /internal/issues/issue-uuid-789/state
{
  "state": "in_progress"
}

// Response
{
  "success": true,
  "data": {}
}
```

### Validate Issue

**Domain Use Case:** `validateIssue`

**When to use:** When you need to verify that a Linear issue identifier exists and belongs to the user's configured team before performing operations on it (e.g., creating subtasks or referencing a parent issue).

**Input:**

```typescript
interface ValidateIssueRequest {
  identifier: string;  // e.g., "INT-123"
  userId: string;
}
```

**Output:**

```typescript
interface ValidatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[];
  childCount: number;
}
```

**Error Codes:** `INVALID_FORMAT`, `NOT_CONNECTED`, `NOT_FOUND`, `WRONG_TEAM`, `API_ERROR`

### Generate Issue Title

**Domain Use Case:** `generateIssueTitle`

**When to use:** When you need to generate a concise issue title from a task description using LLM. Falls back to regex-based extraction if LLM is unavailable.

**Input:**

```typescript
interface GenerateIssueTitleRequest {
  description: string;
  userId: string;
}
```

**Output:**

```typescript
interface GeneratedTitle {
  title: string;                                          // Max 80 characters
  issueType: 'bug' | 'feature' | 'refactor' | 'research'; // Classified issue type
}
```

### List Issues (Dashboard)

**Endpoint:** `GET /linear/issues`

**When to use:** When displaying user's Linear issues grouped by workflow stage.

**Query Parameters:**

```typescript
interface ListIssuesQuery {
  includeArchive?: 'true' | 'false'; // Include old completed issues (default: true)
}
```

**Output Schema:**

```typescript
interface ListIssuesOutput {
  issues: {
    todo: LinearIssue[];        // Ready to start
    backlog: LinearIssue[];     // Planned
    in_progress: LinearIssue[]; // Being worked on
    in_review: LinearIssue[];   // In code review
    to_test: LinearIssue[];     // Awaiting QA
    done: LinearIssue[];        // Completed (last 7 days)
    archive: LinearIssue[];     // Older completed
  };
  teamName: string;
}

interface LinearIssue {
  id: string;
  identifier: string;  // e.g., "INT-123"
  title: string;
  description: string | null;
  priority: 0 | 1 | 2 | 3 | 4;  // 0=none, 1=urgent, 4=low
  state: {
    id: string;
    name: string;
    type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
  };
  url: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
```

### Full Sync

**Endpoint:** `POST /linear/sync`

**When to use:** To trigger a full reconciliation of all Linear issues for the authenticated user. Creates new records, updates existing ones, and deletes stale issues.

**Output Schema:**

```typescript
interface SyncStats {
  created: number;
  updated: number;
  deleted: number;
  total: number;
  durationMs: number;
  syncedAt: string;
}
```

### Get Connection Status

**Endpoint:** `GET /linear/connection`

**When to use:** Check if user has connected their Linear account.

**Output Schema:**

```typescript
interface ConnectionOutput {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### List Failed Issues

**Endpoint:** `GET /linear/failed-issues`

**When to use:** Review issues that failed AI extraction for manual intervention.

**Output Schema:**

```typescript
interface FailedIssuesOutput {
  failedIssues: FailedLinearIssue[];
}

interface FailedLinearIssue {
  id: string;
  userId: string;
  actionId: string;
  originalText: string;
  extractedTitle: string | null;
  extractedPriority: number | null;
  error: string;
  reasoning: string | null;
  createdAt: string;
  lastRetryAt?: string;
}
```

### Retry Failed Issue

**Endpoint:** `POST /linear/failed-issues/:id/retry`

**When to use:** Re-attempt creating a Linear issue from a previously failed extraction. On success, deletes the failed record and returns the created issue. On failure, updates the error message and retry timestamp.

### Delete Failed Issue

**Endpoint:** `DELETE /linear/failed-issues/:id`

**When to use:** Dismiss a failed extraction that is not actionable. Returns 204 No Content on success.

### Webhook Configuration

**Endpoints:**
- `GET /linear/webhook-config` - Get webhook URL and secret status
- `POST /linear/webhook-config` - Set webhook signing secret (`{"secret": "..."}`)
- `DELETE /linear/webhook-config` - Remove webhook signing secret

**When to use:** Configure real-time sync between Linear and IntexuraOS. The webhook URL is provided by the GET endpoint and should be registered in Linear Settings > API > Webhooks.

---

## Constraints

| Rule                        | Description                                                                      |
| --------------------------- | -------------------------------------------------------------------------------- |
| **Linear API Key Required** | User must have Linear API key configured via `/linear/connection`                |
| **Team Scope**              | Issues created in user's configured team                                         |
| **Priority Scale**          | 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low                       |
| **Idempotency**             | Same `actionId` returns cached result, no duplicate issues                       |
| **Auth Required**           | Public endpoints require Bearer token, internal requires X-Internal-Auth         |
| **Internal API Auth**       | Internal issues endpoints also require X-User-Id header                          |
| **Webhook Secret**          | Webhook events require HMAC-SHA256 signature validation per connection           |
| **Issue Identifier Format** | Must match `XXX-123` pattern (uppercase letters, hyphen, digits)                 |
| **Title Length**            | Generated titles are max 80 characters                                           |

---

## Usage Patterns

### Pattern 1: Create Issue from Voice

```
1. Receive voice transcription from whatsapp-service
2. commands-agent classifies as "linear" action type
3. actions-agent creates action and calls POST /internal/linear/process-action
4. linear-agent extracts issue data using LLM
5. linear-agent creates issue in Linear
6. Return issue URL to caller
```

### Pattern 2: Code Agent Issue Management

```
1. Code agent validates parent issue: validateIssue("INT-445", userId)
2. Code agent generates title: generateIssueTitle(description, userId)
3. Code agent creates subtask: POST /internal/issues {title, description}
4. Code agent starts work: PATCH /internal/issues/:id/state {state: "in_progress"}
5. Code agent opens PR: PATCH /internal/issues/:id/state {state: "in_review"}
```

### Pattern 3: Dashboard Display

```
1. User navigates to Linear dashboard
2. Frontend calls GET /linear/issues
3. Display issues in 3-column layout:
   - Planning: todo + backlog
   - Work: in_progress + in_review + to_test
   - Closed: done
4. Refresh periodically or on user action
```

### Pattern 4: Webhook-Based Real-Time Sync

```
1. User configures webhook in Linear (URL from GET /linear/webhook-config)
2. User saves webhook secret via POST /linear/webhook-config
3. Linear sends issue events to POST /linear/webhook
4. linear-agent validates HMAC signature and routes by team ID
5. syncSingleIssue creates/updates/deletes local SyncedLinearIssue
```

### Pattern 5: Full Sync Recovery

```
1. User triggers POST /linear/sync (or Cloud Scheduler for all users)
2. linear-agent fetches all issues from Linear API
3. Compares with local Firestore records
4. Upserts new/changed issues, deletes stale ones
5. Returns SyncStats with created/updated/deleted/total/durationMs
```

### Pattern 6: Handle Extraction Failures

```
1. Monitor GET /linear/failed-issues for pending items
2. Display failed issues with original text and error
3. Allow user to:
   a. Retry via POST /linear/failed-issues/:id/retry
   b. Dismiss via DELETE /linear/failed-issues/:id
   c. Create issue manually
```

---

## Dashboard Column Mapping (v2.0.0)

Linear state names map to dashboard columns:

| State Name Pattern         | Dashboard Column | Example States             |
| -------------------------- | ---------------- | -------------------------- |
| Contains "review"          | `in_review`      | In Review, Code Review     |
| Contains "test/qa/quality" | `to_test`        | To Test, QA, Quality Check |
| Exactly "Todo"             | `todo`           | Todo                       |
| Type = backlog             | `backlog`        | Backlog                    |
| Type = unstarted           | `todo`           | (default for unstarted)    |
| Type = started             | `in_progress`    | In Progress                |
| Type = completed/cancelled | `done`           | Done, Cancelled            |

---

## Error Handling

| Error Code          | HTTP  | Meaning                    | Recovery Action               |
| ------------------- | ----- | -------------------------- | ----------------------------- |
| `NOT_CONNECTED`     | 403   | No Linear connection       | Prompt user to connect Linear |
| `INVALID_API_KEY`   | 401   | Linear API key invalid     | Prompt user to reconnect      |
| `RATE_LIMIT`        | 429   | Linear API rate limited    | Wait and retry with backoff   |
| `EXTRACTION_FAILED` | 200\* | AI could not extract issue | Review failed issues manually |
| `API_ERROR`         | 500   | Linear API failure         | Retry with backoff            |
| `INTERNAL_ERROR`    | 500   | Database or processing err | Retry with backoff            |
| `INVALID_FORMAT`    | 400   | Bad issue identifier       | Fix identifier format         |
| `NOT_FOUND`         | 404   | Issue not in workspace     | Verify identifier is correct  |
| `WRONG_TEAM`        | 403   | Issue in different team    | Use correct team connection   |

\*Note: `EXTRACTION_FAILED` returns 200 with `status: 'failed'` per ServiceFeedback contract.

---

## Dependencies

| Service              | Why Needed                 | Failure Behavior     |
| -------------------- | -------------------------- | -------------------- |
| user-service         | Get LLM API key for user   | Return NOT_CONNECTED |
| app-settings-service | LLM pricing context        | Use default pricing  |
| Linear API           | Create/list/update issues  | Return API_ERROR     |
| Linear Webhooks      | Real-time issue events     | Retry by Linear      |

---

## Internal Endpoints

| Method | Path                                  | Purpose                            |
| ------ | ------------------------------------- | ---------------------------------- |
| POST   | `/internal/linear/process-action`     | Create issue from natural language |
| POST   | `/internal/issues`                    | Create issue programmatically      |
| PATCH  | `/internal/issues/:issueId/state`     | Update issue workflow state        |

---

**Last updated:** 2026-02-08
