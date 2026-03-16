# Linear Agent — Tutorial

> **Time:** 40–50 minutes
> **Prerequisites:** Node.js 20+, Linear account with API key, IntexuraOS running locally
> **You'll learn:** How to connect Linear, create issues via AI, view issues with parent-child support, read comments, configure webhooks, sync issues, use the internal API, and observe auto-triggered code tasks

---

## What You'll Build

A working integration that:

- Connects your Linear workspace to IntexuraOS
- Creates issues from natural language via AI extraction
- Views issues grouped by workflow stage with sub-issues and labels
- Fetches issue detail and comments
- Configures webhooks for real-time issue sync with multi-user fan-out
- Triggers full issue synchronization
- Manages issues programmatically via the internal API (create, state, comments, labels, tree)
- Observes auto-triggered code tasks on issue assignment
- Handles errors and reviews failed extractions

---

## Prerequisites

Before starting, ensure you have:

- [ ] IntexuraOS running locally (`pnpm run dev`)
- [ ] A valid Auth0 access token
- [ ] Linear account with API key ([generate here](https://linear.app/settings/api))
- [ ] Linear team ID (visible in Linear settings)

---

## Part 1: Connect to Linear (5 minutes)

### Step 1.1: Validate Your API Key

First, validate your Linear API key and retrieve available teams.

```bash
curl -X POST http://localhost:3000/linear/connection/validate \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "lin_api_YOUR_KEY_HERE"}'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "teams": [
      { "id": "team-uuid-123", "name": "Engineering", "key": "ENG" },
      { "id": "team-uuid-456", "name": "Product", "key": "PRD" }
    ]
  }
}
```

### Step 1.2: Save the Connection

Save your Linear connection with your preferred team.

```bash
curl -X POST http://localhost:3000/linear/connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN" \
  -d '{
    "apiKey": "lin_api_YOUR_KEY_HERE",
    "teamId": "team-uuid-123",
    "teamName": "Engineering"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "teamId": "team-uuid-123",
    "teamName": "Engineering",
    "createdAt": "2026-03-07T10:00:00.000Z",
    "updatedAt": "2026-03-07T10:00:00.000Z"
  }
}
```

### Step 1.3: Verify Connection Status

```bash
curl http://localhost:3000/linear/connection \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Checkpoint:** You should see `"connected": true` with your team name.

---

## Part 2: Create Issues via AI (10 minutes)

Issues are created through the internal API when actions-agent routes a `linear` action type.

### Step 2.1: Direct Internal API Call (Testing)

```bash
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "action": {
      "id": "test-action-001",
      "userId": "YOUR_USER_ID",
      "text": "Create a bug report for the login button not responding on iOS. Users tap the button but nothing happens. This is high priority since it blocks mobile users."
    }
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Issue ENG-123 created successfully",
    "resourceUrl": "https://linear.app/your-team/issue/ENG-123"
  }
}
```

Note: Both success and failure return HTTP 200 — this is the `ServiceFeedback` contract. Check `status` to determine the outcome.

### Step 2.2: What the AI Extracts

| Field                       | Extracted Value                                        |
| --------------------------- | ------------------------------------------------------ |
| **Title**                   | Fix unresponsive login button on iOS                   |
| **Priority**                | 2 (High) — from "high priority"                        |
| **Functional Requirements** | Login button must respond to tap events on iOS devices |
| **Technical Details**       | Investigate touch event handling in iOS build          |

### Step 2.3: Test Priority Detection

Try different urgency levels:

**Urgent:**

```bash
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "action": {
      "id": "test-action-002",
      "userId": "YOUR_USER_ID",
      "text": "URGENT: Production database is timing out on all queries."
    }
  }'
```

Result: Priority 1 (Urgent)

**Low:**

```bash
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "action": {
      "id": "test-action-003",
      "userId": "YOUR_USER_ID",
      "text": "When you have time, it would be nice to add a dark mode toggle."
    }
  }'
```

Result: Priority 4 (Low)

### Step 2.4: Verify Idempotency

Re-send `test-action-001` with the same `id` — the service returns the existing result without creating a duplicate issue.

**Checkpoint:** All three issues should appear in your Linear workspace with correct priorities. Duplicate sends are harmless.

---

## Part 3: View Issues in Dashboard (5 minutes)

### Step 3.1: Initial Full Sync

The dashboard reads from local Firestore cache. Run a full sync first to populate it.

```bash
curl -X POST http://localhost:3000/linear/sync \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "created": 15,
    "updated": 0,
    "deleted": 0,
    "total": 15,
    "durationMs": 2340,
    "syncedAt": "2026-03-07T10:15:00.000Z"
  }
}
```

### Step 3.2: List Grouped Issues

Fetch issues grouped by dashboard column (from Firestore — no Linear API call).

```bash
curl http://localhost:3000/linear/issues \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

Note how parent issues have their `children` array populated — sub-issues are nested under their parent. Issues sort by most recently updated within each column.

### Step 3.3: Get Issue Detail

```bash
curl http://localhost:3000/linear/issues/ENG-123 \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

Returns issue with `commentCount`, `lastCommentAt`, labels with colors, and assignee data.

### Step 3.4: Fetch Issue Comments

```bash
curl "http://localhost:3000/linear/issues/ENG-123/comments?limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

Returns paginated comments with author names, markdown body, and timestamps.

**Checkpoint:** Issues load instantly from Firestore. Parent-child hierarchy is preserved. Comments are paginated.

---

## Part 4: Configure Webhooks (5 minutes)

Real-time sync: when something changes in Linear, the webhook fans out to all connected users for that team.

### Step 4.1: Get Webhook Configuration

```bash
curl http://localhost:3000/linear/webhook-config \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

### Step 4.2: Set Up in Linear

1. Go to Linear Settings → API → Webhooks
2. Create a new webhook with the URL from step 4.1
3. Select "Issues" and "Comments" as resource types
4. Copy the webhook signing secret

### Step 4.3: Configure the Webhook Secret

```bash
curl -X POST http://localhost:3000/linear/webhook-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN" \
  -d '{"secret": "YOUR_LINEAR_WEBHOOK_SECRET"}'
```

### Step 4.4: Verify Webhook is Active

Create or update an issue in Linear. The webhook fans out to all connected users for that team — each user's local Firestore store gets updated concurrently.

**Checkpoint:** After configuring the webhook, changes in Linear should appear in the local issue repository for all connected team members automatically.

---

## Part 5: Internal API for Code Agents (10 minutes)

Code agents use internal endpoints to manage issues programmatically. All internal endpoints require both `X-Internal-Auth` and `X-User-Id` headers.

### Step 5.1: Validate a Parent Issue

Confirm an issue exists and belongs to the user's connected team.

```bash
curl "http://localhost:3000/internal/linear/issues/ENG-100/validate?userId=YOUR_USER_ID" \
  -H "X-Internal-Auth: your-internal-secret"
```

Returns issue `id`, `identifier`, `title`, `url`, `labels` (names only), `childCount`, and `parentId`.

### Step 5.2: Generate an Issue Title

```bash
curl -X POST http://localhost:3000/internal/linear/issues/generate-title \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "description": "The sidebar crashes when clicking settings on iOS 17.",
    "userId": "YOUR_USER_ID"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "title": "Sidebar crashes on settings click in iOS 17",
    "issueType": "bug"
  }
}
```

The `issueType` is one of: `feature`, `bug`, `refactor`, `research`. Title generation retries once on failure — if both attempts fail, it returns an error rather than degrading silently.

### Step 5.3: Create an Issue

```bash
curl -X POST http://localhost:3000/internal/issues \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{
    "title": "Implement pagination for user list",
    "description": "Add cursor-based pagination to the GET /users endpoint."
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "identifier": "ENG-44",
    "title": "Implement pagination for user list",
    "url": "https://linear.app/engineering/issue/ENG-44"
  }
}
```

### Step 5.4: Update Issue State

```bash
curl -X PATCH http://localhost:3000/internal/issues/ISSUE_ID/state \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{"state": "in_progress"}'
```

Available states: `backlog`, `todo`, `in_progress`, `in_review`, `qa`, `done`. The endpoint maps these to Linear workflow state names and resolves the state ID before updating.

### Step 5.5: Add a Comment

```bash
curl -X POST http://localhost:3000/internal/linear/issues/ISSUE_ID/comments \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{"body": "Implementation started. Working on the pagination logic."}'
```

### Step 5.6: Update Labels and Assignee

```bash
curl -X PATCH http://localhost:3000/internal/linear/issues/ISSUE_ID/metadata \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{
    "addLabels": ["in-progress"],
    "removeLabels": ["backlog"]
  }'
```

Labels are resolved by name. Unknown label names are silently dropped — verify labels exist in your Linear workspace.

### Step 5.7: Batch Fetch Issues for Display

Retrieve multiple issues with their comment counts in a single request.

```bash
curl -X POST http://localhost:3000/internal/linear/issues/display-batch \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{"identifiers": ["ENG-100", "ENG-101", "ENG-102"]}'
```

Missing identifiers are omitted from the response. Results preserve the input order.

### Step 5.8: Get Issue Tree

Fetch an issue and all its recursive descendants from local Firestore data — no Linear API call.

```bash
curl http://localhost:3000/internal/issues/ISSUE_ID/tree \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID"
```

**Checkpoint:** You can create issues, generate titles, validate identifiers, move through the workflow, add comments, update metadata, fetch batches, and traverse trees using the internal API.

---

## Part 6: Auto-Trigger Code Tasks (3 minutes)

When an issue with a "planning-task" or "code-task" label is assigned for the first time, the Linear Agent automatically triggers a code task.

### How It Works

The auto-trigger fires when all of these conditions are met:

1. A webhook `update` event arrives
2. The issue had no previous assignee (`updatedFrom.assigneeId` is null)
3. The issue now has an assignee
4. The issue is in a `backlog` or `unstarted` state
5. The issue has a `planning-task` or `code-task` label

The prompt depends on the label:

- **`code-task` label:** Execution prompt — implement requirements, write code, run CI, create PR
- **`planning-task` label:** Assignment prompt — analyze issue, enrich description with requirements and acceptance criteria, mark ready for execution

Both prompts instruct the code agent to read the full issue and all its comments (newest-first) before starting work.

### Test the Auto-Trigger

1. Create a new issue in Linear (status: Todo, no assignee, add a "planning-task" label)
2. Assign yourself to the issue
3. Check the linear-agent logs for: `Code task triggered from assignment`

**Checkpoint:** The code agent starts working on the issue within seconds. The trigger is fire-and-forget — failures appear in logs, not in the webhook response.

---

## Part 7: Handle Errors (5 minutes)

### Error: Not Connected

**Solution:** Complete Part 1 to connect your Linear account.

### Error: Stale Dashboard Data

The dashboard reads from Firestore cache. Trigger a full sync:

```bash
curl -X POST http://localhost:3000/linear/sync \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

### Error: Extraction Failed

List and retry failed extractions:

```bash
# List failed issues
curl http://localhost:3000/linear/failed-issues \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"

# Retry a failed issue
curl -X POST http://localhost:3000/linear/failed-issues/FAILED_ID/retry \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"

# Delete a failed issue
curl -X DELETE http://localhost:3000/linear/failed-issues/FAILED_ID \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

---

## Troubleshooting

| Symptom                       | Likely Cause                 | Solution                                                            |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| "Linear not connected"        | No saved connection for user | POST `/linear/connection` with credentials                          |
| "Invalid API key"             | Expired or revoked key       | Generate new key in Linear settings                                 |
| Extraction returns null title | Input too vague              | Provide more specific issue description                             |
| Webhook not syncing           | Missing webhook secret       | POST `/linear/webhook-config` with secret                           |
| Webhook 401 errors            | Wrong secret                 | Reconfigure secret in Linear and IntexuraOS                         |
| Dashboard shows stale data    | Firestore not populated      | POST `/linear/sync` to run full sync                                |
| Title generation returns 500  | LLM failed after 2 attempts  | Retry request or use a manual title                                 |
| No child issues on dashboard  | Not synced yet               | Run full sync to populate parent-child data                         |
| Other user missing updates    | Old single-user routing      | Ensure webhook configured; fan-out is default                       |
| Internal endpoint returns 401 | Missing header               | Both `X-Internal-Auth` and `X-User-Id` required for issue endpoints |

---

## Exercises

### Easy

1. Connect your Linear account and verify `connected: true`.
2. Create an issue with no urgency keywords — confirm it defaults to Normal (priority 3).
3. Trigger a full sync and verify the created/updated counts.

### Medium

4. Create issues with all four priority levels (urgent, high, normal, low) and verify them in Linear.
5. Configure a webhook and verify real-time sync by updating an issue in Linear.
6. Send vague input ("fix bug") — find it in the failed-issues queue, then delete it.
7. Use the batch display endpoint to fetch three issues with their comment counts in one call.

### Hard

8. Simulate the full code-agent workflow: create an issue with `POST /internal/issues`, move it to `in_progress`, add a comment, update a label, then move it to `done`.
9. Create a parent issue in Linear, create two sub-issues, run a full sync, then verify the tree structure with `GET /internal/issues/:issueId/tree`.
10. Test the auto-trigger: create an issue with a `planning-task` label, assign it, and trace the log output to confirm the code agent receives the task.

<details>
<summary>Solutions</summary>

### Exercise 4: All Priority Levels

```bash
# Urgent (1)
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{"action": {"id": "ex4-1", "userId": "USER", "text": "URGENT: Server is down"}}'

# High (2)
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{"action": {"id": "ex4-2", "userId": "USER", "text": "High priority: Fix security vulnerability"}}'

# Normal (3) — no keywords
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{"action": {"id": "ex4-3", "userId": "USER", "text": "Add export to CSV feature"}}'

# Low (4)
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{"action": {"id": "ex4-4", "userId": "USER", "text": "When you have time, update the footer copyright"}}'
```

### Exercise 8: Full Code-Agent Workflow

```bash
# 1. Create issue
ISSUE=$(curl -s -X POST http://localhost:3000/internal/issues \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"title": "Fix login on iOS", "description": "Users cannot sign in on iOS."}')
ISSUE_ID=$(echo $ISSUE | jq -r '.data.id')

# 2. Move to in_progress
curl -X PATCH "http://localhost:3000/internal/issues/$ISSUE_ID/state" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"state": "in_progress"}'

# 3. Add comment
curl -X POST "http://localhost:3000/internal/linear/issues/$ISSUE_ID/comments" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"body": "Root cause identified: token handler rejects the auth flow on Safari."}'

# 4. Add label
curl -X PATCH "http://localhost:3000/internal/linear/issues/$ISSUE_ID/metadata" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"addLabels": ["bug"]}'

# 5. Mark done
curl -X PATCH "http://localhost:3000/internal/issues/$ISSUE_ID/state" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"state": "done"}'
```

</details>

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for API details, domain models, and Firestore collection schemas
2. Check the [Features](features.md) page for the product-level overview
3. Review [Technical Debt](technical-debt.md) for known limitations and future plans

---

**Last updated:** 2026-03-15
