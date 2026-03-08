# linear-agent - Agent Interface

> Machine-readable interface definition for AI agents interacting with linear-agent.

---

## Identity

| Field    | Value                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Name** | linear-agent                                                                                                                     |
| **Role** | Linear Issue Management with AI Extraction, Webhook Sync, Auto-Trigger, and Programmatic Issue Control                           |
| **Goal** | Create and manage Linear issues from natural language, sync via webhooks, auto-trigger code tasks, and serve code agent requests |

---

## Capabilities

### Process Action (Create Issue from Natural Language)

**Endpoint:** `POST /internal/linear/process-action`

**When to use:** When you need to create a Linear issue from natural language input (voice transcription, text command).

**Input Schema:**

```typescript
interface ProcessActionInput {
  action: {
    id: string; // Unique action ID (for idempotency)
    userId: string; // User ID
    text: string; // Natural language description
    summary?: string; // Optional pre-extracted summary
  };
}
```

**Output Schema:**

```typescript
interface ProcessActionOutput {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string; // Linear issue URL (success only)
  errorCode?: string; // Error code (failure only)
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

### Validate Issue

**Endpoint:** `GET /internal/linear/issues/:identifier/validate?userId=<userId>`

**When to use:** When you need to verify that a Linear issue identifier exists and belongs to the user's configured team before performing operations on it (e.g., creating subtasks or referencing a parent issue).

**Auth:** `X-Internal-Auth` header

**Output Schema:**

```typescript
interface ValidatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[]; // Label names only (color stripped for simplicity)
  childCount: number;
  parentId: string | null; // Parent issue UUID (null if top-level)
}
```

**Error Codes:** `INVALID_FORMAT` (400), `NOT_CONNECTED` (403), `NOT_FOUND` (404), `WRONG_TEAM` (404), `API_ERROR` (500)

**Example:**

```json
// GET /internal/linear/issues/INT-445/validate?userId=user-xyz
// Response
{
  "id": "issue-uuid-abc",
  "identifier": "INT-445",
  "title": "Implement authentication flow",
  "url": "https://linear.app/team/issue/INT-445",
  "labels": ["feature", "auth"],
  "childCount": 3
}
```

### Generate Issue Title

**Endpoint:** `POST /internal/linear/issues/generate-title`

**When to use:** When you need to generate a concise issue title from a task description using LLM. Returns an error if LLM fails after 2 attempts — handle the error case explicitly.

**Auth:** `X-Internal-Auth` header

**Input Schema:**

```typescript
interface GenerateIssueTitleInput {
  description: string;
  userId: string;
}
```

**Output Schema:**

```typescript
interface GeneratedTitle {
  title: string; // Max 80 characters
  issueType: 'bug' | 'feature' | 'refactor' | 'research'; // Classified issue type
}
```

**Example:**

```json
// Request
{ "description": "The sidebar crashes when you click the settings icon on iOS 17", "userId": "user-xyz" }

// Response
{ "title": "Fix sidebar crash on settings icon tap (iOS 17)", "issueType": "bug" }
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
  labels?: string[]; // Accepted for future use (not forwarded to Linear yet)
}
```

**Output Schema:**

```typescript
interface IssueResponse {
  id: string;
  identifier: string; // e.g., "INT-123"
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
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa';
}
```

**State Name Mapping:**

| Input         | Linear State Name |
| ------------- | ----------------- |
| `backlog`     | Backlog           |
| `todo`        | Todo              |
| `in_progress` | In Progress       |
| `in_review`   | In Review         |
| `qa`          | QA                |

**Example:**

```json
// Request: PATCH /internal/issues/issue-uuid-789/state
{ "state": "in_progress" }

// Response
{ "success": true, "data": {} }
```

### Add Comment to Issue

**Endpoint:** `POST /internal/linear/issues/:issueId/comments`

**When to use:** When a code agent needs to add a comment to a Linear issue (e.g., posting progress updates, analysis results, or PR links).

**Auth:** `X-Internal-Auth` header + `X-User-Id` header

**Input Schema:**

```typescript
interface AddCommentInput {
  body: string; // Markdown comment body
}
```

**Output Schema:**

```typescript
interface AddCommentOutput {
  id: string; // Created comment ID
}
```

**Example:**

```json
// Request: POST /internal/linear/issues/issue-uuid-789/comments
{ "body": "Analysis complete. Found 3 acceptance criteria. See updated description." }

// Response
{ "id": "comment-uuid-456" }
```

### Update Issue Metadata

**Endpoint:** `PATCH /internal/linear/issues/:issueId/metadata`

**When to use:** When a code agent needs to update an issue's assignee or labels. Labels are resolved by name against the team's label set — you do not need label IDs.

**Auth:** `X-Internal-Auth` header + `X-User-Id` header

**Input Schema:**

```typescript
interface UpdateIssueMetadataInput {
  assigneeId?: string | null; // Linear user ID, or null to unassign
  addLabels?: string[]; // Label names to add
  removeLabels?: string[]; // Label names to remove
}
```

**Output Schema:**

```typescript
interface UpdateMetadataOutput {
  id: string;
  labels: { id: string; name: string; color: string }[];
  assignee: { id: string; name: string } | null;
}
```

**Example:**

```json
// Request: PATCH /internal/linear/issues/issue-uuid-789/metadata
{ "addLabels": ["code-task"], "removeLabels": ["needs-triage"] }

// Response
{
  "id": "issue-uuid-789",
  "labels": [{ "id": "label-1", "name": "code-task", "color": "#4CAF50" }],
  "assignee": { "id": "user-abc", "name": "Jane Doe" }
}
```

### Get Issue Display Data (Batch)

**Endpoint:** `POST /internal/linear/issues/display-batch`

**When to use:** When you need display data for multiple Linear issues in a single call (e.g., rendering a list of related issues). Missing identifiers are silently omitted from the response.

**Auth:** `X-Internal-Auth` header + `X-User-Id` header

**Input Schema:**

```typescript
interface DisplayBatchInput {
  identifiers: string[]; // Issue identifiers (e.g., ["INT-123", "INT-456"])
}
```

**Output Schema:**

```typescript
interface DisplayBatchOutput {
  issues: IssueDisplayResponse[];
}

interface IssueDisplayResponse {
  identifier: string;
  title: string;
  state: { name: string; type: string };
  priority: number;
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string }[];
  url: string;
  commentCount: number;
  lastCommentAt: string | null;
}
```

**Example:**

```json
// Request
{ "identifiers": ["INT-123", "INT-456", "INT-999"] }

// Response (INT-999 not found, omitted)
{
  "issues": [
    {
      "identifier": "INT-123",
      "title": "Fix login flow",
      "state": { "name": "In Progress", "type": "started" },
      "priority": 2,
      "assignee": { "id": "user-abc", "name": "Jane Doe" },
      "labels": [{ "id": "label-1", "name": "bug" }],
      "url": "https://linear.app/team/issue/INT-123",
      "commentCount": 5,
      "lastCommentAt": "2026-03-05T14:30:00Z"
    }
  ]
}
```

### Get Issue (Internal)

**Endpoint:** `GET /internal/linear/issues/:identifier`

**When to use:** When a code agent needs the full issue detail including description, comment count, and last comment timestamp. Reads from local Firestore sync — does not call Linear API.

**Auth:** `X-Internal-Auth` header + `X-User-Id` header

**Output Schema:**

```typescript
interface InternalIssueOutput {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  priority: number;
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  lastCommentAt: string | null;
}
```

**Example:**

```json
// GET /internal/linear/issues/INT-445
// Response
{
  "id": "issue-uuid-abc",
  "identifier": "INT-445",
  "title": "Implement authentication flow",
  "description": "## Requirements\n...",
  "state": { "name": "In Progress", "type": "started" },
  "priority": 2,
  "assignee": { "id": "user-abc", "name": "Jane Doe" },
  "labels": [{ "id": "label-1", "name": "feature" }],
  "url": "https://linear.app/team/issue/INT-445",
  "createdAt": "2026-02-10T10:00:00Z",
  "updatedAt": "2026-03-05T14:30:00Z",
  "commentCount": 3,
  "lastCommentAt": "2026-03-05T14:30:00Z"
}
```

### Get Issue Tree

**Endpoint:** `GET /internal/issues/:issueId/tree`

**When to use:** When a code agent needs to see an issue and all its recursive descendants (subtasks, sub-subtasks). Reads from local Firestore sync — does not call Linear API. Useful for understanding work breakdown before creating additional subtasks.

**Auth:** `X-Internal-Auth` header + `X-User-Id` header

**Output Schema:**

```typescript
interface IssueTreeOutput {
  root: TreeNode;
  descendants: TreeNode[];
}

interface TreeNode {
  id: string;
  identifier: string;
  url: string;
  parentId: string | null;
  labels: string[]; // Label names only
  assigneeId: string | null;
  state: string; // State name
}
```

**Example:**

```json
// GET /internal/issues/issue-uuid-parent/tree
// Response
{
  "root": {
    "id": "issue-uuid-parent",
    "identifier": "INT-100",
    "url": "https://linear.app/team/issue/INT-100",
    "parentId": null,
    "labels": ["feature"],
    "assigneeId": "user-abc",
    "state": "In Progress"
  },
  "descendants": [
    {
      "id": "issue-uuid-child-1",
      "identifier": "INT-101",
      "url": "https://linear.app/team/issue/INT-101",
      "parentId": "issue-uuid-parent",
      "labels": ["code-task"],
      "assigneeId": "user-abc",
      "state": "Done"
    }
  ]
}
```

### Full Sync (Service-to-Service)

**Endpoint:** `POST /internal/linear/sync`

**When to use:** When another service needs to trigger a full sync for a specific user programmatically.

**Auth:** `X-Internal-Auth` header

**Input Schema:**

```typescript
interface SyncInput {
  userId: string;
}
```

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

### Full Sync All Users (Cloud Scheduler)

**Endpoint:** `POST /internal/linear/sync-all`

**When to use:** Scheduled by Cloud Scheduler to sync all connected users. Accepts OIDC Bearer token (from Cloud Scheduler) or `X-Internal-Auth` header.

**Output Schema:**

```typescript
interface SyncAllStats {
  userCount: number;
  totalIssues: number;
}
```

### List Issues (Dashboard)

**Endpoint:** `GET /linear/issues`

**When to use:** When displaying user's Linear issues grouped by workflow stage. Reads from local Firestore cache — fast and does not call Linear API.

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
    todo: LinearIssue[]; // Ready to start
    backlog: LinearIssue[]; // Planned
    in_progress: LinearIssue[]; // Being worked on
    in_review: LinearIssue[]; // In code review
    to_test: LinearIssue[]; // Awaiting QA
    done: LinearIssue[]; // Completed (last 7 days)
    archive: LinearIssue[]; // Older completed
  };
  teamName: string;
}

interface LinearIssue {
  id: string;
  identifier: string; // e.g., "INT-123"
  title: string;
  description: string | null;
  priority: 0 | 1 | 2 | 3 | 4; // 0=none, 1=urgent, 4=low
  state: {
    id: string;
    name: string;
    type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
  };
  url: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  parentId?: string | null;
  childCount: number; // Number of children
  children: LinearIssue[]; // Populated for top-level issues
  labels: LinearLabel[];
}

interface LinearLabel {
  id: string;
  name: string;
  color: string; // Hex color
}
```

### Get Issue Detail

**Endpoint:** `GET /linear/issues/:identifier`

**When to use:** Fetch a single issue with comment metadata (count and last activity).

**Auth:** Bearer token

**Output Schema:**

```typescript
interface IssueDetailOutput {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  priority: number;
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string; color: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  lastCommentAt: string | null;
}
```

### List Issue Comments

**Endpoint:** `GET /linear/issues/:identifier/comments`

**When to use:** Fetch paginated comments for an issue.

**Auth:** Bearer token

**Query Parameters:** `limit` (1-100, default 20), `offset` (default 0)

**Output Schema:**

```typescript
interface CommentsOutput {
  comments: {
    id: string;
    userId: string; // Linear user ID
    userName: string;
    body: string; // Markdown
    createdAt: string;
    updatedAt: string;
  }[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
```

### Full Sync (User-Triggered)

**Endpoint:** `POST /linear/sync`

**When to use:** To trigger a full reconciliation of all Linear issues for the authenticated user.

**Auth:** Bearer token

**Output:** `SyncStats` (created, updated, deleted, total, durationMs, syncedAt)

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

### Failed Issues

**Endpoints:**

- `GET /linear/failed-issues` — Review issues that failed AI extraction
- `POST /linear/failed-issues/:id/retry` — Re-attempt creating issue (uses real team ID)
- `DELETE /linear/failed-issues/:id` — Dismiss a failed extraction (204 No Content)

### Webhook Configuration

**Endpoints:**

- `GET /linear/webhook-config` — Get webhook URL and secret status
- `POST /linear/webhook-config` — Set webhook signing secret (`{"secret": "..."}`)
- `DELETE /linear/webhook-config` — Remove webhook signing secret

---

## Constraints

| Rule                         | Description                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------- |
| **Linear API Key Required**  | User must have Linear API key configured via `/linear/connection`                |
| **Team Scope**               | Issues created in user's configured team                                         |
| **Priority Scale**           | 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low                       |
| **Idempotency**              | Same `actionId` returns cached result, no duplicate issues                       |
| **Auth Required**            | Public endpoints require Bearer token, internal requires X-Internal-Auth         |
| **Internal API Auth**        | Internal issues endpoints also require X-User-Id header                          |
| **Webhook Secret**           | Webhook events require HMAC-SHA256 signature validation per connection           |
| **Issue Identifier Format**  | Must match `XXX-123` pattern (uppercase letters, hyphen, digits)                 |
| **Title Length**             | Generated titles are max 80 characters                                           |
| **Title Error on Failure**   | `generateIssueTitle` returns err() after 2 failed attempts — no fallback         |
| **Dashboard from Firestore** | `GET /linear/issues` reads local cache; sync first if data looks stale           |
| **Labels in POST /issues**   | `labels` field accepted but not forwarded to Linear API yet                      |
| **sync-all Auth**            | Accepts OIDC (Cloud Scheduler) or X-Internal-Auth                                |
| **Auto-Trigger Guards**      | Only fires on first assignment, backlog or unstarted state, no "Code Task" label |
| **Auto-Trigger Fire-Forget** | Code task trigger does not block webhook response; errors logged only            |
| **Metadata Ownership**       | `PATCH /metadata` returns 404 (not 403) if issue belongs to another user         |
| **Display Batch Omission**   | `POST /display-batch` silently omits identifiers not found in user's sync        |
| **Tree from Local Sync**     | `GET /tree` uses Firestore data only — no Linear API calls                       |

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
1. Code agent validates parent issue: GET /internal/linear/issues/INT-445/validate?userId=...
2. Code agent generates title: POST /internal/linear/issues/generate-title
3. Code agent creates subtask: POST /internal/issues {title, description}
4. Code agent adds labels: PATCH /internal/linear/issues/:id/metadata {addLabels: ["code-task"]}
5. Code agent starts work: PATCH /internal/issues/:id/state {state: "in_progress"}
6. Code agent posts update: POST /internal/linear/issues/:id/comments {body: "PR opened..."}
7. Code agent opens PR: PATCH /internal/issues/:id/state {state: "in_review"}
```

### Pattern 3: Dashboard Display

```
1. User navigates to Linear dashboard
2. Frontend calls GET /linear/issues (reads Firestore cache -- fast)
3. Display issues in 3-column layout with parent-child nesting and label colors:
   - Planning: todo + backlog
   - Work: in_progress + in_review + to_test
   - Closed: done
4. For issue detail: GET /linear/issues/:identifier (includes commentCount)
5. For comments: GET /linear/issues/:identifier/comments
```

### Pattern 4: Auto-Trigger Code Task on Assignment

```
1. User assigns themselves to a backlog or unstarted issue in Linear
2. Linear sends webhook update event to POST /linear/webhook
3. Webhook fans out to all connected users for the team
4. shouldTriggerCodeTask validates: first assignment, backlog/unstarted state, no "code-task" label
5. Checks for "code-task" label to select prompt:
   - Has "code-task" label -> EXECUTION_PROMPT (implement requirements)
   - No "code-task" label -> ASSIGNMENT_PROMPT (analyze/enrich/mark ready)
6. triggerCodeTaskFromAssignment calls code-agent POST /internal/code/process (fire-and-forget)
```

### Pattern 5: Webhook-Based Real-Time Sync

```
1. User configures webhook in Linear (URL from GET /linear/webhook-config)
2. User saves webhook secret via POST /linear/webhook-config
3. Linear sends issue events to POST /linear/webhook
4. linear-agent validates HMAC signature and routes by team ID
5. Fans out to all connected users for the team via findUserIdsByTeamId
6. syncSingleIssue creates/updates/deletes local SyncedLinearIssue per user (composite key: userId_issueId)
7. Dashboard shows updated data on next load
```

### Pattern 6: Full Sync Recovery

```
1. User triggers POST /linear/sync (or Cloud Scheduler calls POST /internal/linear/sync-all)
2. linear-agent fetches all issues from Linear API
3. Compares with local Firestore records (scoped by userId via composite keys)
4. Upserts new/changed issues, deletes stale ones
5. Returns SyncStats with created/updated/deleted/total/durationMs
```

### Pattern 7: Handle Extraction Failures

```
1. Monitor GET /linear/failed-issues for pending items
2. Display failed issues with original text and error
3. Allow user to:
   a. Retry via POST /linear/failed-issues/:id/retry (uses real team ID)
   b. Dismiss via DELETE /linear/failed-issues/:id
   c. Create issue manually
```

### Pattern 8: Code Agent Issue Tree Inspection

```
1. Code agent receives a parent issue to work on
2. Fetches issue tree: GET /internal/issues/:issueId/tree
3. Inspects root and descendants to understand existing subtask breakdown
4. Creates only the subtasks that don't already exist
5. Posts batch display: POST /internal/linear/issues/display-batch {identifiers: [...]}
6. Uses display data to format progress summaries
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
| `LLM_ERROR`         | 500   | Title generation failed    | Retry or use fallback title   |
| `PARSE_ERROR`       | 500   | Title JSON invalid         | Retry or use fallback title   |

\*Note: `EXTRACTION_FAILED` returns 200 with `status: 'failed'` per ServiceFeedback contract.

---

## Dependencies

| Service              | Why Needed                         | Failure Behavior        |
| -------------------- | ---------------------------------- | ----------------------- |
| user-service         | Get LLM API key for user           | Return NOT_CONNECTED    |
| app-settings-service | LLM pricing context                | Use default pricing     |
| code-agent           | Auto-trigger code tasks on assign  | Error logged, not fatal |
| Linear API           | Create/list/update issues          | Return API_ERROR        |
| Linear Webhooks      | Real-time issue events             | Retry by Linear         |

---

## Internal Endpoints Summary

| Method | Path                                           | Purpose                              |
| ------ | ---------------------------------------------- | ------------------------------------ |
| POST   | `/internal/linear/process-action`              | Create issue from natural language   |
| GET    | `/internal/linear/issues/:identifier/validate` | Validate issue exists + team         |
| POST   | `/internal/linear/issues/generate-title`       | Generate LLM title from desc         |
| POST   | `/internal/linear/sync`                        | Full sync for a specific user        |
| POST   | `/internal/linear/sync-all`                    | Full sync for all users              |
| POST   | `/internal/issues`                             | Create issue programmatically        |
| PATCH  | `/internal/issues/:issueId/state`              | Update issue workflow state          |
| POST   | `/internal/linear/issues/:issueId/comments`    | Add comment to issue                 |
| PATCH  | `/internal/linear/issues/:issueId/metadata`    | Update assignee and labels           |
| POST   | `/internal/linear/issues/display-batch`        | Get display data for multiple issues |
| GET    | `/internal/linear/issues/:identifier`          | Get issue with comment data          |
| GET    | `/internal/issues/:issueId/tree`               | Get issue with recursive descendants |

---

**Last updated:** 2026-03-07
