# Cron Agent — Tutorial

> **Time:** 15-30 minutes
> **Prerequisites:** Node.js 20+, GCP project access, valid auth token
> **You'll learn:** How to create recurring schedules, trigger them manually, and inspect execution results

---

## What You'll Build

A working integration that:

- Creates an automated schedule from a natural language description
- Triggers the schedule manually and inspects the execution result
- Lists and manages schedules programmatically

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS project
- [ ] A valid Bearer token (JWT from Auth0)
- [ ] At least one target service running with an OpenAPI spec (e.g., notes-agent)

---

## Part 1: Discover Available Services (3 minutes)

Before creating a schedule, check which services and tools are available for the agent to use.

### Step 1.1: List Available Services

```bash
curl -X GET https://dev.intexuraos.cloud/api/cron-agent/cron/services \
  -H "Authorization: Bearer $TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "services": [
      {
        "key": "notes-agent",
        "name": "Notes Agent",
        "tools": [
          {
            "name": "notes_agent__createNote",
            "description": "Create note - Create a new note for the authenticated user.",
            "parameters": { "type": "object", "properties": { "body": { "..." } } }
          }
        ]
      }
    ]
  }
}
```

### What Just Happened?

The cron-agent fetched OpenAPI specs from all configured target services, extracted their `/internal/*` endpoints, and returned them as available tools. These are the tools the agent can use when executing your schedules.

---

## Part 2: Create Your First Schedule (10 minutes)

### Step 2.1: Prepare the Schedule

Choose a target service and an instruction. The `description` field is the natural language schedule — the LLM converts this to a cron expression.

### Step 2.2: Create the Schedule

```bash
curl -X POST https://dev.intexuraos.cloud/api/cron-agent/cron/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Note Reminder",
    "description": "every weekday at 9am",
    "action": {
      "services": ["notes-agent"],
      "instruction": "Create a note titled Daily Standup Prep with the current date."
    },
    "timezone": "Europe/Warsaw"
  }'
```

**Expected response (201):**

```json
{
  "success": true,
  "data": {
    "id": "abc123def456",
    "userId": "auth0|...",
    "name": "Daily Note Reminder",
    "description": "every weekday at 9am",
    "cronExpression": "0 9 * * 1-5",
    "timezone": "Europe/Warsaw",
    "action": {
      "services": ["notes-agent"],
      "instruction": "Create a note titled Daily Standup Prep with the current date.",
      "preferredTools": []
    },
    "status": "active",
    "lastExecutedAt": null,
    "nextExecutionAt": "2026-03-23T08:00:00.000Z",
    "executionCount": 0,
    "failureCount": 0,
    "createdAt": "2026-03-22T...",
    "updatedAt": "2026-03-22T..."
  }
}
```

### What Just Happened?

The service sent your description ("every weekday at 9am") to Gemini 2.5 Flash, which returned the cron expression `0 9 * * 1-5`. The service validated the expression, computed the next execution time in your timezone, and stored everything in Firestore.

### Step 2.3: Verify the Schedule

```bash
curl -X GET https://dev.intexuraos.cloud/api/cron-agent/cron/schedules/abc123def456 \
  -H "Authorization: Bearer $TOKEN"
```

**Checkpoint:** You should see the schedule with `status: "active"` and a valid `nextExecutionAt` timestamp.

---

## Part 3: Trigger and Inspect (10 minutes)

### Step 3.1: Manually Trigger the Schedule

Instead of waiting for Cloud Scheduler, trigger the schedule immediately:

```bash
curl -X POST https://dev.intexuraos.cloud/api/cron-agent/cron/schedules/abc123def456/trigger \
  -H "Authorization: Bearer $TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "exec789xyz",
    "scheduleId": "abc123def456",
    "scheduleName": "Daily Note Reminder",
    "status": "success",
    "trigger": "manual",
    "startedAt": "2026-03-22T...",
    "completedAt": "2026-03-22T...",
    "durationMs": 3200,
    "toolCalls": [
      {
        "toolName": "notes_agent__createNote",
        "args": { "body": { "title": "Daily Standup Prep", "content": "..." } },
        "result": "{\"success\":true,\"data\":{...}}",
        "durationMs": 1500
      }
    ],
    "agentResponse": "I created a note titled 'Daily Standup Prep' with today's date.",
    "tokenUsage": {
      "inputTokens": 1200,
      "outputTokens": 85,
      "totalCost": 0.0003
    },
    "error": null,
    "createdAt": "2026-03-22T..."
  }
}
```

### Step 3.2: List Execution History

```bash
curl -X GET "https://dev.intexuraos.cloud/api/cron-agent/cron/executions?scheduleId=abc123def456" \
  -H "Authorization: Bearer $TOKEN"
```

**Checkpoint:** You should see your manual execution in the list with `status: "success"` and detailed tool call logs.

---

## Part 4: Manage Schedules (5 minutes)

### Step 4.1: Pause a Schedule

```bash
curl -X PATCH https://dev.intexuraos.cloud/api/cron-agent/cron/schedules/abc123def456 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "paused"}'
```

When paused, `nextExecutionAt` is set to `null` and the schedule is skipped during tick processing.

### Step 4.2: Resume a Schedule

```bash
curl -X PATCH https://dev.intexuraos.cloud/api/cron-agent/cron/schedules/abc123def456 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

Resuming recomputes `nextExecutionAt` from the current time and cron expression.

### Step 4.3: Delete a Schedule

```bash
curl -X DELETE https://dev.intexuraos.cloud/api/cron-agent/cron/schedules/abc123def456 \
  -H "Authorization: Bearer $TOKEN"
```

**Result:** The schedule is soft-deleted (`status: "deleted"`, `nextExecutionAt: null`).

---

## Troubleshooting

| Problem                            | Solution                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| "401 Unauthorized"                 | Check your Bearer token is valid and not expired                             |
| "PARSE_FAILED"                     | Reword your schedule description — the LLM could not convert it to cron      |
| "INVALID_CRON: frequency too high" | Schedules must run at least 5 minutes apart                                  |
| "Unknown service: xyz"             | The service key is not in the allowed services list — check `/cron/services` |
| "Schedule is already running"      | Wait for the current execution to complete before triggering again           |
| "Maximum of 50 schedules"          | Delete unused schedules to make room                                         |

---

## Next Steps

Now that you understand the basics:

1. Create a multi-service schedule using tools from two or more services
2. Use `preferredTools` to guide the agent toward specific API operations
3. Read the [Technical Reference](technical.md) for full API and domain model details

---

## Exercises

Test your understanding:

1. **Easy:** Create a schedule that runs every Sunday at midnight UTC
2. **Medium:** Create a schedule targeting two services with preferred tools specified
3. **Hard:** Create a schedule, trigger it, inspect the execution, then update the description to change the frequency and verify the cron expression changed

<details>
<summary>Solutions</summary>

### Exercise 1: Sunday Midnight Schedule

```bash
curl -X POST https://dev.intexuraos.cloud/api/cron-agent/cron/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Cleanup",
    "description": "every Sunday at midnight",
    "action": {
      "services": ["notes-agent"],
      "instruction": "Archive all notes older than 30 days."
    }
  }'
```

### Exercise 2: Multi-Service with Preferred Tools

```bash
curl -X POST https://dev.intexuraos.cloud/api/cron-agent/cron/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sprint Summary",
    "description": "every Friday at 5pm",
    "action": {
      "services": ["linear-agent", "notes-agent"],
      "instruction": "Get completed issues this week and create a summary note.",
      "preferredTools": ["linear_agent__listIssues"]
    },
    "timezone": "Europe/Warsaw"
  }'
```

### Exercise 3: Full Lifecycle

```bash
# 1. Create
SCHEDULE_ID=$(curl -s -X POST .../cron/schedules ... | jq -r '.data.id')

# 2. Trigger
curl -X POST .../cron/schedules/$SCHEDULE_ID/trigger -H "Authorization: Bearer $TOKEN"

# 3. List executions
curl -X GET ".../cron/executions?scheduleId=$SCHEDULE_ID" -H "Authorization: Bearer $TOKEN"

# 4. Update description (re-parses cron expression)
curl -X PATCH .../cron/schedules/$SCHEDULE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "every other Monday at 10am"}'

# 5. Verify new cron expression
curl -X GET .../cron/schedules/$SCHEDULE_ID -H "Authorization: Bearer $TOKEN"
# cronExpression should now reflect biweekly Mondays
```

</details>
