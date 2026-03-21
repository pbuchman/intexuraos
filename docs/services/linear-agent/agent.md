# linear-agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Name      | linear-agent                                                                                            |
| Role      | Bidirectional Linear integration — create issues from text, sync boards, manage issues programmatically |
| Goal      | Keep the IntexuraOS issue board current and enable AI-driven issue lifecycle management                 |

## Capabilities

### Process Natural Language Action

**Endpoint:** `POST /internal/linear/process-action`

**When to use:** When you have a user message (voice transcription or text) that should become a Linear issue. Always returns HTTP 200 — check `status` field.

**Input Schema:**

```typescript
interface ProcessActionInput {
  action: {
    id: string;       // Unique action ID — used for idempotency
    userId: string;
    text: string;     // Natural language description
    summary?: string; // Optional pre-summarized key points
  };
}
```

**Output Schema:**

```typescript
interface ProcessActionOutput {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string;  // Linear issue URL (success only)
  errorCode?: string;    // 'EXTRACTION_FAILED' | 'EXTERNAL_API_ERROR' (failure only)
}
```

**Example:**

```json
// Request
{
  "action": {
    "id": "action-abc-123",
    "userId": "user-xyz",
    "text": "The login button is broken on iOS — high priority, affects all mobile users"
  }
}

// Response (success)
{
  "status": "completed",
  "message": "Issue ENG-45 created successfully",
  "resourceUrl": "https://linear.app/team/issue/ENG-45"
}

// Response (failure)
{
  "status": "failed",
  "message": "Could not extract valid issue from message",
  "errorCode": "EXTRACTION_FAILED"
}
```

---

### Validate Issue Identifier

**Endpoint:** `GET /internal/linear/issues/:identifier/validate?userId=<userId>`

**When to use:** Before operating on a Linear issue — confirm it exists and belongs to the user's team.

**Input Schema:**

```typescript
// URL params + query
interface ValidateIssueInput {
  identifier: string; // e.g., "INT-123" — format: /^[A-Z]+-\d+$/
  userId: string;
}
```

**Output Schema:**

```typescript
interface ValidateIssueOutput {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[];       // Label names only
  childCount: number;
  parentId: string | null;
}
```

**Example:**

```json
// GET /internal/linear/issues/ENG-42/validate?userId=user-xyz

// Response
{
  "id": "uuid-abc-123",
  "identifier": "ENG-42",
  "title": "Fix login button on iOS",
  "url": "https://linear.app/team/issue/ENG-42",
  "labels": ["bug", "high-priority"],
  "childCount": 2,
  "parentId": null
}
```

---

### Generate Issue Title

**Endpoint:** `POST /internal/linear/issues/generate-title`

**When to use:** When you have a task description but need a concise Linear issue title (max 80 chars).

**Input Schema:**

```typescript
interface GenerateTitleInput {
  description: string;
  userId: string;
}
```

**Output Schema:**

```typescript
interface GenerateTitleOutput {
  title: string;       // Max 80 chars
  issueType: 'feature' | 'bug' | 'refactor' | 'research';
}
```

**Example:**

```json
// Request
{
  "description": "The sidebar crashes on iOS 17 when the user taps settings",
  "userId": "user-xyz"
}

// Response
{
  "title": "Sidebar crashes on settings tap in iOS 17",
  "issueType": "bug"
}
```

---

### Create Issue

**Endpoint:** `POST /internal/issues`

**When to use:** When programmatically creating a Linear issue (e.g., during code task execution to track sub-work).

**Required headers:** `X-Internal-Auth`, `X-User-Id`

**Input Schema:**

```typescript
interface CreateIssueInput {
  title: string;
  description: string;
  labels?: string[]; // Accepted but not forwarded to Linear yet
}
```

**Output Schema:**

```typescript
interface CreateIssueOutput {
  id: string;
  identifier: string;
  title: string;
  url: string;
}
```

**Example:**

```json
// Request
{
  "title": "Add unit tests for CSV export",
  "description": "## Summary\n\nCover the row-limit edge case."
}

// Response
{
  "id": "uuid-def-456",
  "identifier": "ENG-46",
  "title": "Add unit tests for CSV export",
  "url": "https://linear.app/team/issue/ENG-46"
}
```

---

### Update Issue State

**Endpoint:** `PATCH /internal/issues/:issueId/state`

**When to use:** To advance an issue through the workflow as work progresses.

**Required headers:** `X-Internal-Auth`, `X-User-Id`

**Input Schema:**

```typescript
interface UpdateStateInput {
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
}
```

**Example:**

```json
// Request
{ "state": "in_progress" }

// Response: 200 OK with empty data object
```

---

### Add Comment to Issue

**Endpoint:** `POST /internal/linear/issues/:issueId/comments`

**When to use:** To post progress updates or notes to a Linear issue during code task execution.

**Required headers:** `X-Internal-Auth`, `X-User-Id`

**Input Schema:**

```typescript
interface AddCommentInput {
  body: string; // Markdown supported
}
```

**Output Schema:**

```typescript
interface AddCommentOutput {
  id: string; // Linear comment UUID
}
```

---

### Update Issue Metadata

**Endpoint:** `PATCH /internal/linear/issues/:issueId/metadata`

**When to use:** To set the assignee or modify labels on an issue.

**Required headers:** `X-Internal-Auth`, `X-User-Id`

**Input Schema:**

```typescript
interface UpdateMetadataInput {
  assigneeId?: string | null; // Set or unset assignee
  addLabels?: string[];       // Label names to add
  removeLabels?: string[];    // Label names to remove
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

---

### Get Issue with Comment Data

**Endpoint:** `GET /internal/linear/issues/:identifier`

**When to use:** To read a specific issue and its comment metadata before starting work.

**Required headers:** `X-Internal-Auth`, `X-User-Id`

**Output Schema:**

```typescript
interface GetIssueOutput {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' };
  priority: 0 | 1 | 2 | 3 | 4;
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  lastCommentAt: string | null;
}
```

---

### Batch Fetch Issues for Display

**Endpoint:** `POST /internal/linear/issues/display-batch`

**When to use:** When you need display data for multiple issues at once — more efficient than individual fetches.

**Required headers:** `X-Internal-Auth`, `X-User-Id`

**Input Schema:**

```typescript
interface DisplayBatchInput {
  identifiers: string[]; // e.g., ["INT-123", "INT-456"]
}
```

**Output Schema:**

```typescript
interface DisplayBatchOutput {
  issues: {
    identifier: string;
    title: string;
    state: { name: string; type: string };
    priority: number;
    assignee: { id: string; name: string } | null;
    labels: { id: string; name: string }[];
    url: string;
    commentCount: number;
    lastCommentAt: string | null;
  }[];
}
```

Missing identifiers are silently omitted. Results preserve the input order.

---

### Get Issue Tree

**Endpoint:** `GET /internal/issues/:issueId/tree`

**When to use:** To understand the parent-child hierarchy of an issue and all its descendants from local Firestore data.

**Required headers:** `X-Internal-Auth`, `X-User-Id`

**Output Schema:**

```typescript
interface IssueTreeOutput {
  root: {
    id: string;
    identifier: string;
    url: string;
    parentId: string | null;
    labels: string[];        // Label names
    assigneeId: string | null;
    state: string;
  };
  descendants: {
    id: string;
    identifier: string;
    url: string;
    parentId: string | null;
    labels: string[];
    assigneeId: string | null;
    state: string;
  }[];
}
```

---

### Full Sync (Single User)

**Endpoint:** `POST /internal/linear/sync`

**When to use:** After a user connects or when you suspect local data may be stale.

**Input Schema:**

```typescript
interface FullSyncInput {
  userId: string;
}
```

**Output Schema:**

```typescript
interface SyncOutput {
  created: number;
  updated: number;
  deleted: number;
  total: number;
  durationMs: number;
  syncedAt: string;
}
```

---

## Constraints

**Do NOT:**

- Fabricate `actionId` values — they must be unique per action to guarantee idempotency
- Call `POST /internal/issues` expecting labels to be set — the `labels` field is accepted but not forwarded to Linear yet; use `PATCH /internal/linear/issues/:issueId/metadata` afterward
- Use `GET /internal/linear/issues/:identifier` with an identifier from a different user's workspace — issue lookup is scoped by `X-User-Id`
- Expect state names to be case-sensitive — Linear states are mapped case-insensitively

**Requires:**

- User must have an active Linear connection (saved API key + team) before any issue operations
- All `/internal/issues/*` and `/internal/linear/issues/*` endpoints require both `X-Internal-Auth` and `X-User-Id` headers
- Issue must be synced to local Firestore before `GET /internal/issues/:issueId/tree` will find it — run a full sync if needed
- Linear issue identifier must match format `XXX-123` (uppercase letters, hyphen, digits) for `validateIssue`

## Usage Patterns

### Pattern 1: Natural Language to Linear Issue

```
1. Call POST /internal/linear/process-action with actionId + userId + text
2. Check response.status === 'completed'
3. If 'failed' and errorCode === 'EXTRACTION_FAILED': inform user, suggest clearer input
4. On success: return resourceUrl to caller
```

### Pattern 2: Code Task Issue Lifecycle

```
1. Call GET /internal/linear/issues/:identifier to read current state and comments
2. Call POST /internal/issues to create sub-tasks as needed
3. Call PATCH /internal/issues/:issueId/state to advance workflow (in_progress → in_review → done)
4. Call POST /internal/linear/issues/:issueId/comments to post progress notes
5. Call PATCH /internal/linear/issues/:issueId/metadata to update labels/assignee
```

### Pattern 3: Validate Before Operating

```
1. Call GET /internal/linear/issues/:identifier/validate?userId=<userId>
2. Confirm issue belongs to user's team (404 = wrong team or not found)
3. Check childCount and parentId to understand hierarchy
4. Proceed with operations using the returned id (Linear UUID)
```

### Pattern 4: Batch Display for UI

```
1. Collect identifiers needed for display (e.g., ["INT-100", "INT-101"])
2. Call POST /internal/linear/issues/display-batch with identifiers array
3. Use returned issues array for display — missing identifiers are silently omitted
4. Note: results preserve the input identifier order
```

### Pattern 5: Hierarchy Navigation

```
1. Call GET /internal/issues/:issueId/tree to get root + all descendants
2. Traverse descendants array — each item has parentId to reconstruct tree
3. Use labels array (names) and state to determine current workflow position
4. No Linear API call is made — operates entirely on local Firestore data
```

## Error Handling

| Error Code | Meaning                             | Recovery Action                                        |
| ---------- | ----------------------------------- | ------------------------------------------------------ |
| 200        | Check `status` field for failure    | `status: 'failed'` is not an HTTP error — read message |
| 400        | Invalid input or format             | Fix request payload (e.g., invalid identifier format)  |
| 401        | Unauthorized                        | Check `X-Internal-Auth` and `X-User-Id` headers        |
| 403        | User not connected to Linear        | User must connect via `POST /linear/connection` first  |
| 404        | Issue not found or wrong team       | Verify identifier and that user is on correct team     |
| 500        | Internal or downstream error        | Retry with backoff; check Linear API status            |

## Events Published

None. linear-agent does not publish Pub/Sub events. It receives webhook events from Linear and routes them internally.

## Incoming Webhook

Linear sends issue and comment events to `POST /linear/webhook`. The service:

1. Validates HMAC-SHA256 signature using per-team webhook secret
2. Fans out issue changes to all connected users for that team
3. Auto-triggers a code task when an issue with `planning-task` or `code-task` label is assigned for the first time

## Dependencies

| Service              | Why Needed                     | Failure Behavior                     |
| -------------------- | ------------------------------ | ------------------------------------ |
| user-service         | LLM API key for extraction     | Returns `NOT_CONNECTED` on failure   |
| app-settings-service | LLM pricing context at startup | Startup fails if unreachable         |
| code-agent           | Auto-trigger on assignment     | Logged and dropped (fire-and-forget) |
| Linear API           | Issue CRUD, team data          | Returns error to caller              |
| Firestore            | Local issue/comment storage    | Returns `INTERNAL_ERROR`             |
