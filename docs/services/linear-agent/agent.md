# linear-agent - Agent Interface

> Machine-readable interface definition for AI agents interacting with linear-agent.

---

## Identity

| Field    | Value                                                                  |
| -------- | ---------------------------------------------------------------------- |
| **Name** | linear-agent                                                           |
| **Role** | Linear Issue Management with AI Extraction                             |
| **Goal** | Create Linear issues from natural language and provide dashboard views |

---

## Capabilities

### Process Action (Create Issue)

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
}
```

---

## Constraints

| Rule                        | Description                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| **Linear API Key Required** | User must have Linear API key configured via `/linear/connection`        |
| **Team Scope**              | Issues created in user's configured team                                 |
| **Priority Scale**          | 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low               |
| **Idempotency**             | Same `actionId` returns cached result, no duplicate issues               |
| **Auth Required**           | Public endpoints require Bearer token, internal requires X-Internal-Auth |

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

### Pattern 2: Dashboard Display

```
1. User navigates to Linear dashboard
2. Frontend calls GET /linear/issues
3. Display issues in 3-column layout:
   - Planning: todo + backlog
   - Work: in_progress + in_review + to_test
   - Closed: done
4. Refresh periodically or on user action
```

### Pattern 3: Handle Extraction Failures

```
1. Monitor GET /linear/failed-issues for pending items
2. Display failed issues with original text and error
3. Allow user to:
   a. Edit and retry with more detail
   b. Create issue manually
   c. Dismiss as not actionable
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

\*Note: `EXTRACTION_FAILED` returns 200 with `status: 'failed'` per ServiceFeedback contract.

---

## Dependencies

| Service              | Why Needed               | Failure Behavior     |
| -------------------- | ------------------------ | -------------------- |
| user-service         | Get LLM API key for user | Return NOT_CONNECTED |
| app-settings-service | LLM pricing context      | Use default pricing  |
| Linear API           | Create/list issues       | Return API_ERROR     |

---

## Internal Endpoints

| Method | Path                              | Purpose                            |
| ------ | --------------------------------- | ---------------------------------- |
| POST   | `/internal/linear/process-action` | Create issue from natural language |

---

**Last updated:** 2026-01-24
