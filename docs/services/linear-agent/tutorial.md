# Linear Agent Tutorial

> **Time:** 35-45 minutes
> **Prerequisites:** Node.js 20+, Linear account with API key, IntexuraOS running locally
> **You'll learn:** How to connect Linear, create issues via AI, view issues with parent-child support, read comments, configure webhooks, sync issues, use the internal API, and observe auto-triggered code tasks

---

## What You'll Build

A working integration that:

- Connects your Linear workspace to IntexuraOS
- Creates issues from natural language via AI extraction
- Views issues grouped by workflow stage with sub-issues and labels
- Fetches issue detail and comments
- Configures webhooks for real-time issue sync
- Triggers full issue synchronization
- Manages issues programmatically via the internal API
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
    "createdAt": "2026-02-19T10:00:00.000Z",
    "updatedAt": "2026-02-19T10:00:00.000Z"
  }
}
```

### Step 1.3: Verify Connection Status

Check your current connection status.

```bash
curl http://localhost:3000/linear/connection \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Checkpoint:** You should see `"connected": true` with your team name.

---

## Part 2: Create Issues via AI (10 minutes)

Issues are created through the internal API when actions-agent routes a `linear` action type.

### Step 2.1: Direct Internal API Call (Testing)

For testing, call the internal endpoint directly with natural language.

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

The extraction service parses your natural language into structured data:

| Field                       | Extracted Value                                        |
| --------------------------- | ------------------------------------------------------ |
| **Title**                   | Fix unresponsive login button on iOS                   |
| **Priority**                | 2 (High) - from "high priority"                        |
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
      "text": "URGENT: Production database is timing out on all queries. Users cannot load any data."
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
      "text": "When you have time, it would be nice to add a dark mode toggle in the settings page."
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
    "syncedAt": "2026-02-19T10:15:00.000Z"
  }
}
```

### Step 3.2: List Grouped Issues

Fetch issues grouped by dashboard column (from Firestore — fast!).

```bash
curl http://localhost:3000/linear/issues \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "issues": {
      "todo": [
        {
          "identifier": "ENG-125",
          "title": "Add dark mode toggle",
          "priority": 4,
          "children": [],
          "labels": []
        }
      ],
      "backlog": [],
      "in_progress": [
        {
          "identifier": "ENG-100",
          "title": "Implement authentication flow",
          "priority": 2,
          "childCount": 2,
          "children": [
            { "identifier": "ENG-101", "title": "Add OAuth provider", "priority": 2 },
            { "identifier": "ENG-102", "title": "Write auth tests", "priority": 3 }
          ],
          "labels": [{ "id": "label-1", "name": "feature", "color": "#0075ff" }]
        }
      ],
      "in_review": [],
      "to_test": [],
      "done": [
        {
          "identifier": "ENG-120",
          "title": "Previous completed issue",
          "priority": 3,
          "children": [],
          "labels": []
        }
      ],
      "archive": []
    },
    "teamName": "Engineering"
  }
}
```

Note how `ENG-100` has its `children` array populated — sub-issues are nested under their parent.

### Step 3.3: Understanding Column Mapping

Issues are grouped based on Linear state names:

| Linear State Name | Dashboard Column | Visual Grouping |
| ----------------- | ---------------- | --------------- |
| Todo              | `todo`           | Planning column |
| Backlog           | `backlog`        | Planning column |
| In Progress       | `in_progress`    | Work column     |
| In Review         | `in_review`      | Work column     |
| Code Review       | `in_review`      | Work column     |
| To Test           | `to_test`        | Work column     |
| QA                | `to_test`        | Work column     |
| Done              | `done`           | Closed column   |
| Cancelled         | `done`           | Closed column   |

### Step 3.4: Get Issue Detail

Fetch a single issue with comment count and last activity.

```bash
curl http://localhost:3000/linear/issues/ENG-123 \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "identifier": "ENG-123",
    "title": "Fix unresponsive login button on iOS",
    "state": { "name": "In Progress", "type": "started" },
    "priority": 2,
    "assignee": null,
    "labels": [{ "id": "label-1", "name": "bug", "color": "#e11d48" }],
    "commentCount": 3,
    "lastCommentAt": "2026-02-18T14:22:00.000Z",
    "url": "https://linear.app/your-team/issue/ENG-123"
  }
}
```

### Step 3.5: Fetch Issue Comments

Get paginated comments for an issue.

```bash
curl "http://localhost:3000/linear/issues/ENG-123/comments?limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "comments": [
      {
        "id": "comment-uuid-1",
        "userId": "linear-user-abc",
        "userName": "Alice Smith",
        "body": "Reproduced on iPhone 15. Tap gesture not firing.",
        "createdAt": "2026-02-17T10:00:00.000Z",
        "updatedAt": "2026-02-17T10:00:00.000Z"
      }
    ],
    "total": 3,
    "limit": 10,
    "offset": 0,
    "hasMore": false
  }
}
```

---

## Part 4: Configure Webhooks (5 minutes)

Webhooks enable real-time issue sync from Linear to IntexuraOS.

### Step 4.1: Get Webhook Configuration

Check the webhook URL and secret status.

```bash
curl http://localhost:3000/linear/webhook-config \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "webhookUrl": "https://intexuraos-linear-agent-cj44trunra-lm.a.run.app/linear/webhook",
    "hasWebhookSecret": false,
    "teamId": "team-uuid-123"
  }
}
```

### Step 4.2: Set Up in Linear

1. Go to Linear Settings > API > Webhooks
2. Create a new webhook with the URL from step 4.1
3. Select "Issues" as the resource type
4. Copy the webhook signing secret that Linear generates

### Step 4.3: Configure the Webhook Secret

```bash
curl -X POST http://localhost:3000/linear/webhook-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN" \
  -d '{"secret": "YOUR_LINEAR_WEBHOOK_SECRET"}'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "configured": true
  }
}
```

### Step 4.4: Verify Webhook is Active

Create or update an issue in Linear. The webhook endpoint at `POST /linear/webhook` receives the event, validates the HMAC-SHA256 signature, and syncs the issue to local Firestore storage.

**Checkpoint:** After configuring the webhook, changes in Linear should appear in the local issue repository automatically.

---

## Part 5: Full Issue Sync (3 minutes)

Trigger a full reconciliation of all issues from Linear.

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
    "updated": 3,
    "deleted": 1,
    "total": 18,
    "durationMs": 2340,
    "syncedAt": "2026-02-19T10:15:00.000Z"
  }
}
```

The sync creates new local records, updates existing ones, and deletes issues that no longer exist in Linear.

---

## Part 6: Internal API for Code Agents (7 minutes)

Code agents use internal endpoints to manage issues programmatically.

### Step 6.1: Validate a Parent Issue

Before creating a subtask, verify the parent issue exists and belongs to the user's team.

```bash
curl "http://localhost:3000/internal/linear/issues/ENG-100/validate?userId=YOUR_USER_ID" \
  -H "X-Internal-Auth: your-internal-secret"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "id": "issue-uuid-abc",
    "identifier": "ENG-100",
    "title": "Implement authentication flow",
    "url": "https://linear.app/your-team/issue/ENG-100",
    "labels": ["feature"],
    "childCount": 2
  }
}
```

### Step 6.2: Generate an Issue Title

Ask the LLM to generate a concise title from a task description.

```bash
curl -X POST http://localhost:3000/internal/linear/issues/generate-title \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "description": "The sidebar crashes when the user clicks the settings icon on iOS 17 devices. Only affects devices running iOS 17.0 - 17.2.",
    "userId": "YOUR_USER_ID"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "title": "Fix sidebar crash on settings icon tap (iOS 17)",
    "issueType": "bug"
  }
}
```

> **Note:** `generateIssueTitle` returns an error (not a degraded title) if the LLM fails after 2 attempts. Always handle the error case in your code.

### Step 6.3: Create an Issue

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

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "id": "issue-uuid-789",
    "identifier": "ENG-130",
    "title": "Implement pagination for user list",
    "url": "https://linear.app/your-team/issue/ENG-130"
  }
}
```

### Step 6.4: Update Issue State

```bash
curl -X PATCH http://localhost:3000/internal/issues/issue-uuid-789/state \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{"state": "in_progress"}'
```

Available states: `backlog`, `in_progress`, `in_review`, `qa`.

---

## Part 7: Auto-Trigger Code Tasks (3 minutes)

When an issue is assigned in Linear for the first time, Linear Agent can automatically trigger a code task to enrich the issue with requirements and test plans.

### Step 7.1: How It Works

The auto-trigger fires when all of these conditions are met:

1. A webhook `update` event arrives
2. The issue had no previous assignee (`updatedFrom.assigneeId` is null)
3. The issue now has an assignee
4. The issue is in an `unstarted` state
5. The issue does NOT have a `Code Task` label

### Step 7.2: Test the Auto-Trigger

1. Create a new issue in Linear (status: Todo, no assignee)
2. Assign yourself to the issue
3. Check the linear-agent logs for: `Code task triggered from assignment`
4. The code-agent will analyze the issue and enrich its description

**Checkpoint:** The issue description in Linear should be enriched with requirements, acceptance criteria, and a test plan after a short delay.

### What Happens Behind the Scenes

```
1. Linear sends webhook: action=update, assignee changed from null to user
2. linear-agent validates HMAC signature
3. shouldTriggerCodeTask checks all guard conditions
4. triggerCodeTaskFromAssignment calls code-agent POST /internal/code/process
5. code-agent analyzes issue, enriches description, marks ready
```

The trigger is fire-and-forget -- the webhook response is returned immediately without waiting for the code task to complete.

---

## Part 8: Handle Errors (5 minutes)

### Error: Not Connected

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Linear not connected. Please configure in settings."
  }
}
```

**Solution:** Complete Part 1 to connect your Linear account.

### Error: Invalid API Key

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid Linear API key"
  }
}
```

**Solution:** Regenerate your API key in Linear Settings > Account > API.

### Error: Stale Dashboard Data

The dashboard (`GET /linear/issues`) reads from Firestore cache. If it looks outdated, trigger a full sync:

```bash
curl -X POST http://localhost:3000/linear/sync \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

### Error: Extraction Failed

If AI extraction fails, the issue is saved to `failedIssues` for manual review.

```bash
curl http://localhost:3000/linear/failed-issues \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "failedIssues": [
      {
        "id": "failed-123",
        "actionId": "test-action-004",
        "originalText": "fix bug",
        "extractedTitle": null,
        "error": "Could not extract meaningful issue details from input",
        "reasoning": "Input too vague to determine specific issue",
        "createdAt": "2026-02-19T10:30:00.000Z"
      }
    ]
  }
}
```

### Retry a Failed Issue

```bash
curl -X POST http://localhost:3000/linear/failed-issues/failed-123/retry \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

On success, the failed issue is deleted and the created Linear issue is returned. Uses your real team ID (not a placeholder).

### Delete a Failed Issue

```bash
curl -X DELETE http://localhost:3000/linear/failed-issues/failed-123 \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

Returns 204 No Content on success.

### Test Extraction Failure

Intentionally trigger a failure with vague input:

```bash
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "action": {
      "id": "test-action-005",
      "userId": "YOUR_USER_ID",
      "text": "fix it"
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "failed",
    "message": "Could not extract meaningful issue details from input",
    "errorCode": "EXTRACTION_FAILED"
  }
}
```

---

## Part 9: Real-World Scenario (5 minutes)

### Voice-to-Issue Pipeline

1. **User speaks** into WhatsApp: "Hey, I need a Linear issue for the authentication bug where users can't log in after token expires. This is urgent."

2. **WhatsApp service** receives and transcribes the message.

3. **Commands agent** classifies intent as `linear` action type.

4. **Actions agent** creates action and routes to linear-agent.

5. **Linear agent** processes the action:
   - Extracts: Title="Fix authentication token expiration bug", Priority=1 (Urgent)
   - Creates issue in Linear with structured description
   - Returns success with Linear issue URL

6. **User receives** confirmation with link to the new issue.

### Code Agent Workflow

1. **Code agent** receives a task to implement a feature.
2. Agent validates parent issue via `GET /internal/linear/issues/ENG-100/validate?userId=...`.
3. Agent generates a title from the task description via `POST /internal/linear/issues/generate-title`.
4. Agent creates a subtask via `POST /internal/issues`.
5. Agent moves the issue to "In Progress" via `PATCH /internal/issues/:issueId/state`.
6. After completion, agent moves issue to "In Review".

### Test Idempotency

Send the same action twice to verify duplicate prevention:

```bash
# First request
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "action": {
      "id": "idempotency-test-001",
      "userId": "YOUR_USER_ID",
      "text": "Add pagination to the user list endpoint"
    }
  }'

# Second request (same action ID)
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{
    "action": {
      "id": "idempotency-test-001",
      "userId": "YOUR_USER_ID",
      "text": "Add pagination to the user list endpoint"
    }
  }'
```

Both requests return the same issue URL without creating duplicates.

---

## Troubleshooting

| Symptom                       | Likely Cause                 | Solution                                      |
| ----------------------------- | ---------------------------- | --------------------------------------------- |
| "Linear not connected"        | No saved connection for user | POST `/linear/connection` with credentials    |
| "Invalid API key"             | Expired or revoked key       | Generate new key in Linear settings           |
| Issue created with wrong team | Wrong teamId in connection   | DELETE then POST new connection               |
| Extraction returns null title | Input too vague              | Provide more specific issue description       |
| 429 Rate Limit                | Too many Linear API calls    | Wait and retry (Linear has generous limits)   |
| Issue in wrong column         | Custom state name            | Check state name matches expected patterns    |
| Webhook not syncing           | Missing webhook secret       | POST `/linear/webhook-config` with secret     |
| Webhook 401 errors            | Wrong secret or changed key  | Reconfigure secret in Linear and IntexuraOS   |
| Dashboard shows stale data    | Firestore not populated yet  | POST `/linear/sync` to run full sync          |
| Title generation returns 500  | LLM failed after 2 attempts  | Retry request or use a manual title           |
| No child issues on dashboard  | Not synced yet               | Run a full sync to populate parent-child data |

---

## Exercises

### Easy

1. Connect your Linear account using the validation and connection endpoints.
2. Create an issue with "normal" priority (no urgency keywords).
3. Verify the issue appears in the correct dashboard column after a full sync.

### Medium

4. Create issues with all 4 priority levels (urgent, high, normal, low).
5. Move an issue through workflow stages in Linear and verify column changes (after webhook sync).
6. Send vague text ("fix bug") and retrieve it from failed issues.
7. Configure a webhook and verify real-time sync by creating an issue in Linear.
8. Trigger a full sync and inspect the created/updated/deleted counts.
9. Fetch issue detail and comments for an issue with existing comments.

### Hard

10. Set up the full pipeline: Send a WhatsApp message and trace it through to Linear issue creation.
11. Use the internal API to validate a parent issue, generate a title, create a subtask, and update its state through the workflow.
12. Create a custom Linear workflow with "QA" and "Code Review" states and verify correct column mapping.
13. Delete a failed issue and retry another, verifying the retry creates the Linear issue successfully with the correct team ID.

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

# Normal (3) - no keywords
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

### Exercise 6: Review Failed Issues

```bash
# Send vague input
curl -X POST http://localhost:3000/internal/linear/process-action \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -d '{"action": {"id": "ex6-1", "userId": "USER", "text": "fix bug"}}'

# List failed issues
curl http://localhost:3000/linear/failed-issues \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

### Exercise 11: Internal API Code Agent Workflow

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

# 4. Move to In Progress (use the issue ID from step 3)
curl -X PATCH http://localhost:3000/internal/issues/ISSUE_ID/state \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"state": "in_progress"}'

# 5. Move to In Review
curl -X PATCH http://localhost:3000/internal/issues/ISSUE_ID/state \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: your-internal-secret" \
  -H "X-User-Id: USER" \
  -d '{"state": "in_review"}'
```

</details>

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for API details and architecture
2. Learn about [Actions Agent](../actions-agent/tutorial.md) for action routing
3. Check out [Commands Agent](../commands-agent/tutorial.md) for intent classification

---

**Last updated:** 2026-02-22
