# Linear Agent Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** Node.js 20+, Linear account with API key, IntexuraOS running locally
> **You'll learn:** How to connect Linear, create issues via AI, and view issues in the dashboard

---

## What You'll Build

A working integration that:

- Connects your Linear workspace to IntexuraOS
- Creates issues from natural language via AI extraction
- Views issues grouped by workflow stage in the dashboard
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
    "createdAt": "2026-01-24T10:00:00.000Z",
    "updatedAt": "2026-01-24T10:00:00.000Z"
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

### Step 3.1: List Grouped Issues

Fetch issues grouped by dashboard column.

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
      "todo": [{ "identifier": "ENG-125", "title": "Add dark mode toggle", "priority": 4 }],
      "backlog": [],
      "in_progress": [],
      "in_review": [],
      "to_test": [],
      "done": [{ "identifier": "ENG-120", "title": "Previous completed issue", "priority": 3 }],
      "archive": []
    },
    "teamName": "Engineering"
  }
}
```

### Step 3.2: Understanding Column Mapping

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

### Step 3.3: Exclude Archive (Optional)

To fetch only recent issues without archive:

```bash
curl "http://localhost:3000/linear/issues?includeArchive=false" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

---

## Part 4: Handle Errors (5 minutes)

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
        "createdAt": "2026-01-24T10:30:00.000Z"
      }
    ]
  }
}
```

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

## Part 5: Real-World Scenario (5 minutes)

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

| Symptom                       | Likely Cause                 | Solution                                    |
| ----------------------------- | ---------------------------- | ------------------------------------------- |
| "Linear not connected"        | No saved connection for user | POST `/linear/connection` with credentials  |
| "Invalid API key"             | Expired or revoked key       | Generate new key in Linear settings         |
| Issue created with wrong team | Wrong teamId in connection   | DELETE then POST new connection             |
| Extraction returns null title | Input too vague              | Provide more specific issue description     |
| 429 Rate Limit                | Too many Linear API calls    | Wait and retry (Linear has generous limits) |
| Issue in wrong column         | Custom state name            | Check state name matches expected patterns  |

---

## Exercises

### Easy

1. Connect your Linear account using the validation and connection endpoints.
2. Create an issue with "normal" priority (no urgency keywords).
3. Verify the issue appears in the correct dashboard column.

### Medium

4. Create issues with all 4 priority levels (urgent, high, normal, low).
5. Move an issue through workflow stages in Linear and verify column changes.
6. Send vague text ("fix bug") and retrieve it from failed issues.

### Hard

7. Set up the full pipeline: Send a WhatsApp message and trace it through to Linear issue creation.
8. Implement a retry mechanism for failed extractions using the `/linear/failed-issues` endpoint.
9. Create a custom Linear workflow with "QA" and "Code Review" states and verify correct column mapping.

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

</details>

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for API details and architecture
2. Learn about [Actions Agent](../actions-agent/tutorial.md) for action routing
3. Check out [Commands Agent](../commands-agent/tutorial.md) for intent classification

---

**Last updated:** 2026-01-24
