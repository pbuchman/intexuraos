# Linear Agent Tutorial

> **Time:** 40-50 minutes
> **Prerequisites:** Node.js 22+, Linear account with API key, IntexuraOS running locally
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

### Step 2.2: What the AI Extracts

| Field                       | Extracted Value                                        |
| --------------------------- | ------------------------------------------------------ |
| **Title**                   | Fix unresponsive login button on iOS                   |
| **Priority**                | 2 (High) -- from "high priority"                       |
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

**Checkpoint:** All three issues should appear in your Linear workspace with correct priorities.

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

Fetch issues grouped by dashboard column (from Firestore).

```bash
curl http://localhost:3000/linear/issues \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

Note how parent issues have their `children` array populated -- sub-issues are nested under their parent.

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

---

## Part 4: Configure Webhooks (5 minutes)

### Step 4.1: Get Webhook Configuration

```bash
curl http://localhost:3000/linear/webhook-config \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

### Step 4.2: Set Up in Linear

1. Go to Linear Settings > API > Webhooks
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

Create or update an issue in Linear. The webhook fans out to ALL connected users for that team -- each user's local Firestore store gets updated.

**Checkpoint:** After configuring the webhook, changes in Linear should appear in the local issue repository for all connected team members automatically.

---

## Part 5: Internal API for Code Agents (10 minutes)

Code agents use internal endpoints to manage issues programmatically.

### Step 5.1: Validate a Parent Issue

```bash
curl "http://localhost:3000/internal/linear/issues/ENG-100/validate?userId=YOUR_USER_ID" \
  -H "X-Internal-Auth: your-internal-secret"
```

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

### Step 5.4: Update Issue State

```bash
curl -X PATCH http://localhost:3000/internal/issues/ISSUE_ID/state \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{"state": "in_progress"}'
```

Available states: `backlog`, `todo`, `in_progress`, `in_review`, `qa`.

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

### Step 5.7: Get Issue Tree

Fetch an issue and all its recursive descendants.

```bash
curl http://localhost:3000/internal/issues/ISSUE_ID/tree \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID"
```

### Step 5.8: Batch Fetch Issues for Display

```bash
curl -X POST http://localhost:3000/internal/linear/issues/display-batch \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{"identifiers": ["ENG-100", "ENG-101", "ENG-102"]}'
```

Returns display data for each found issue (missing identifiers are omitted).

---

## Part 6: Auto-Trigger Code Tasks (3 minutes)

When an issue is assigned in Linear for the first time, Linear Agent automatically triggers a code task.

### How It Works

The auto-trigger fires when all of these conditions are met:

1. A webhook `update` event arrives
2. The issue had no previous assignee (`updatedFrom.assigneeId` is null)
3. The issue now has an assignee
4. The issue is in a `backlog` or `unstarted` state

The prompt depends on the issue's labels:

- **With `code-task` label:** EXECUTION_PROMPT -- implement requirements, write code, run CI, create PR
- **Without `code-task` label:** ASSIGNMENT_PROMPT -- analyze issue, enrich description, add acceptance criteria

### Test the Auto-Trigger

1. Create a new issue in Linear (status: Todo, no assignee)
2. Assign yourself to the issue
3. Check the linear-agent logs for: `Code task triggered from assignment`

**Checkpoint:** The code agent should start working on the issue within seconds.

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

| Symptom                       | Likely Cause                 | Solution                                      |
| ----------------------------- | ---------------------------- | --------------------------------------------- |
| "Linear not connected"        | No saved connection for user | POST `/linear/connection` with credentials    |
| "Invalid API key"             | Expired or revoked key       | Generate new key in Linear settings           |
| Extraction returns null title | Input too vague              | Provide more specific issue description       |
| Webhook not syncing           | Missing webhook secret       | POST `/linear/webhook-config` with secret     |
| Webhook 401 errors            | Wrong secret                 | Reconfigure secret in Linear and IntexuraOS   |
| Dashboard shows stale data    | Firestore not populated      | POST `/linear/sync` to run full sync          |
| Title generation returns 500  | LLM failed after 2 attempts  | Retry request or use a manual title           |
| No child issues on dashboard  | Not synced yet               | Run full sync to populate parent-child data   |
| Other user missing updates    | Old single-user routing      | Ensure webhook configured; fan-out is default |

---

## Exercises

### Easy

1. Connect your Linear account using the validation and connection endpoints.
2. Create an issue with "normal" priority (no urgency keywords).
3. Verify the issue appears in the correct dashboard column after a full sync.

### Medium

4. Create issues with all 4 priority levels (urgent, high, normal, low).
5. Configure a webhook and verify real-time sync by creating an issue in Linear.
6. Send vague text ("fix bug") and retrieve it from failed issues.
7. Fetch issue detail and comments for an issue with existing comments.
8. Use the internal API to create an issue, add a comment, and update its labels.

### Hard

9. Set up the full pipeline: Send a WhatsApp message and trace it through to Linear issue creation.
10. Use the internal API to validate a parent issue, generate a title, create a subtask, update its state through the workflow, add comments, and fetch the issue tree.
11. Create a custom Linear workflow with "QA" and "Code Review" states and verify correct column mapping.
12. Test multi-user webhook fan-out: connect two users to the same team and verify both receive issue updates.

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

# Normal (3) -- no keywords
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

### Exercise 10: Full Internal API Workflow

```bash
# 1. Validate parent issue
curl "http://localhost:3000/internal/linear/issues/ENG-100/validate?userId=USER" \
  -H "X-Internal-Auth: your-internal-secret"

# 2. Generate title
curl -X POST http://localhost:3000/internal/linear/issues/generate-title \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{"description": "Add cursor-based pagination to user list API", "userId": "USER"}'

# 3. Create subtask
curl -X POST http://localhost:3000/internal/issues \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"title": "Add pagination to user list", "description": "Implement cursor-based pagination."}'

# 4. Move to In Progress (use issue ID from step 3)
curl -X PATCH http://localhost:3000/internal/issues/ISSUE_ID/state \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"state": "in_progress"}'

# 5. Add a comment
curl -X POST http://localhost:3000/internal/linear/issues/ISSUE_ID/comments \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"body": "Started implementation."}'

# 6. Get issue tree
curl http://localhost:3000/internal/issues/PARENT_ISSUE_ID/tree \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER"
```

</details>

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for API details and architecture
2. Learn about [Actions Agent](../actions-agent/tutorial.md) for action routing
3. Check out [Commands Agent](../commands-agent/tutorial.md) for intent classification

---

**Last updated:** 2026-03-07
