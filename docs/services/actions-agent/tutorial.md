# Actions Agent - Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** IntexuraOS development environment running, Auth0 access token
> **You will learn:** How to list, approve, execute, and manage actions through the actions-agent API

This tutorial walks you through the actions-agent service, from basic listing to advanced action management including WhatsApp approval workflows, code action dispatching, calendar previews, and duplicate resolution.

---

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests
- Familiarity with HTTP clients (curl, Postman, or similar)

---

## Part 1: Hello World - List Your Actions (5 minutes)

The simplest interaction is listing actions for the authenticated user.

### Step 1.1: Get your access token

Authenticate with Auth0 to get an access token:

```bash
# Using the device code flow
curl -X POST https://YOUR_DOMAIN/auth/oauth/device/code \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "YOUR_CLIENT_ID",
    "scope": "openid profile email offline_access",
    "audience": "urn:intexuraos:api"
  }'
```

Follow the verification URL, authenticate, then poll for the token:

```bash
curl -X POST https://YOUR_DOMAIN/auth/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": "YOUR_DEVICE_CODE",
    "client_id": "YOUR_CLIENT_ID"
  }'
```

### Step 1.2: List your actions

```bash
curl -X GET https://actions-agent.intexuraos.com/actions \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "actions": [
      {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "userId": "user_abc",
        "commandId": "cmd_xyz",
        "type": "research",
        "confidence": 0.92,
        "title": "Research quantum computing developments",
        "status": "awaiting_approval",
        "payload": {},
        "createdAt": "2026-01-13T10:00:00Z",
        "updatedAt": "2026-01-13T10:05:00Z"
      }
    ]
  },
  "diagnostics": {
    "requestId": "req_123",
    "durationMs": 45
  }
}
```

### What Just Happened?

The GET `/actions` endpoint returns all actions owned by the authenticated user. Each action has a type (what kind of work it represents), a status (where it is in its lifecycle), and a confidence score (how certain the AI was about the classification).

### Checkpoint

You should see a list of your actions. Try filtering by status:

```bash
curl -X GET "https://actions-agent.intexuraos.com/actions?status=pending,awaiting_approval" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Part 2: WhatsApp Interactive Button Approval (10 minutes)

The most powerful feature of actions-agent is approving actions by tapping interactive WhatsApp buttons.

### How It Works

1. Send a command via WhatsApp: "Research machine learning trends"
2. Receive an approval notification with interactive buttons:
   - **Approve** button
   - **Reject** button
3. Tap **Approve** to execute the action
4. Receive confirmation and later a completion notification with a link

### Understanding the Flow

```
You: "Research machine learning trends"
Bot: "New research request ready for approval
      Review: https://app.intexuraos.com/#/inbox?action=abc123"
      [Approve] [Reject]
You: *tap Approve*
Bot: "Approved! Processing your research: 'Research machine learning trends'"
[Later]
Bot: "Your research is ready! View it here: [link]"
```

### Calendar Actions with Rich Previews

Calendar approval messages include a rich preview of the event details:

```
You: "Schedule team standup tomorrow at 9am for 30 minutes in Room A"
Bot: "Calendar Event

     *Team Standup*
     Mon, Mar 10 . 9:00 AM - 9:30 AM
     30 minutes
     Room A

     Review: https://app.intexuraos.com/#/inbox?action=def456"
     [Approve] [Reject]
You: *tap Approve*
Bot: "Calendar Event Created

     *Team Standup*
     Mon, Mar 10 . 9:00 AM - 9:30 AM
     30 minutes
     Room A"
     [View in Calendar]   <-- tappable link to Google Calendar
```

### If Buttons Expire

WhatsApp interactive buttons can expire. If you send a text reply instead of tapping a button, the system automatically re-sends fresh buttons:

```
You: "yes please"
Bot: "Please use the buttons to approve or reject. If buttons expired, here they are again:"
     [Approve] [Reject]
```

> **Note:** As of v4.0.0, text-based approval (typing "yes"/"no") is no longer supported. The system always re-sends buttons if no button was tapped. No LLM API key is required.

### Auto-Execution

High-confidence actions (>= 90%) skip the approval step entirely and execute immediately. You will receive a completion notification without needing to approve.

### Checkpoint

Send a command via WhatsApp and practice approving/rejecting by tapping the buttons.

---

## Part 3: Update and Execute Actions (5 minutes)

### Update an action status

Move an action from `awaiting_approval` to `processing` (manual approval via API):

```bash
curl -X PATCH https://actions-agent.intexuraos.com/actions/ACTION_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "processing"}'
```

### Reject an action

```bash
curl -X PATCH https://actions-agent.intexuraos.com/actions/ACTION_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "rejected"}'
```

### Change action type

If the AI classified incorrectly, change the type:

```bash
curl -X PATCH https://actions-agent.intexuraos.com/actions/ACTION_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "todo"}'
```

This logs the transition for ML training and re-routes the action.

### Execute an action synchronously

```bash
curl -X POST https://actions-agent.intexuraos.com/actions/ACTION_ID/execute \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "actionId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "completed",
    "resourceUrl": "/#/research/abc123"
  }
}
```

---

## Part 4: Handle Errors (5 minutes)

### Error: Action not found

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Action not found"
  }
}
```

**Cause:** The action does not exist or belongs to another user.

**Solution:** Verify the action ID and that you are authenticated as the owner.

### Error: Unauthorized (401)

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Internal auth failed for create action"
  }
}
```

**Cause:** Missing or invalid `X-Internal-Auth` header for internal endpoints, or invalid Bearer token for public endpoints.

**Solution:** Ensure the shared secret or access token is correctly set.

### Error: Action type mismatch

When processing Pub/Sub events, if the URL action type does not match the event:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Action type mismatch between URL and event"
  }
}
```

**Cause:** Routing configuration error or malformed event.

**Solution:** Verify Pub/Sub subscription endpoints match action types.

---

## Part 5: Real-World Scenario - Duplicate Link Resolution (5 minutes)

When creating a bookmark action, if the URL already exists, the action fails with an `existingBookmarkId` in the payload. Here is how to handle it:

### Step 5.1: Check the failed action

List your failed actions and look for `payload.existingBookmarkId`:

```bash
curl -X GET "https://actions-agent.intexuraos.com/actions?status=failed" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 5.2: Choose resolution

**Skip (reject the new link):**

```bash
curl -X POST https://actions-agent.intexuraos.com/actions/ACTION_ID/resolve-duplicate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "skip"}'
```

**Update (refresh existing bookmark with new OG metadata):**

```bash
curl -X POST https://actions-agent.intexuraos.com/actions/ACTION_ID/resolve-duplicate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "update"}'
```

---

## Part 6: Calendar Action Preview

Calendar actions support previewing before execution.

### Get action preview

```bash
curl -X GET https://actions-agent.intexuraos.com/actions/ACTION_ID/preview \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "preview": {
      "actionId": "abc123",
      "userId": "user_xyz",
      "status": "ready",
      "summary": "Team standup",
      "start": "2026-01-25T09:00:00Z",
      "end": "2026-01-25T09:30:00Z",
      "location": "Conference Room A",
      "isAllDay": false,
      "duration": "30 minutes",
      "reasoning": "Parsed 'Team standup tomorrow at 9am' with 30-minute default duration",
      "generatedAt": "2026-01-24T10:00:00Z"
    }
  }
}
```

> **Note:** As of v4.1.0, calendar previews are generated synchronously when the approval message is sent. The preview is included directly in the WhatsApp approval message, so you may not need to fetch it via API unless displaying it in a different UI.

---

## Part 7: Code Actions (v3.0.0)

Code actions dispatch tasks to code-agent (Claude Code). They use interactive WhatsApp buttons with three options.

### How Code Action Approval Works

1. Send a command: "Fix the authentication bug in the login module"
2. Receive a WhatsApp message with interactive buttons:
   - **Approve** (approve and dispatch to Claude Code)
   - **Reject** (cancel the action)
   - **Convert to Issue** (reject this action but create a Linear issue instead)
3. Tap **Approve** to dispatch to code-agent
4. Receive confirmation and later a completion message with PR/branch details

### Two-Phase Code Tasks (INT-628)

Code tasks can operate in two phases: design and implementation. After the design phase completes, you receive a WhatsApp message with a **Proceed to Implementation** button:

```
Bot: "Design phase complete for your task. Ready to start implementation?"
     [Proceed to Implementation] [Cancel Task] [View Task]
You: *tap Proceed to Implementation*
Bot: "Starting implementation for your task!
      You'll receive another message when it's complete."
```

### Cancelling a Running Code Task

Once a code task starts, the code-agent sends a "task started" WhatsApp message with a **Cancel Task** button:

- Button ID format: `cancel-task:{taskId}:{nonce}`
- The nonce provides a one-time cancellation token for security

Error codes returned when cancellation fails:

| Error Code             | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `TASK_NOT_FOUND`       | Task does not exist                               |
| `INVALID_NONCE`        | Cancel code already used                          |
| `NONCE_EXPIRED`        | Cancel link has expired                           |
| `NOT_OWNER`            | You are not the owner of this task (HTTP 403)     |
| `TASK_NOT_CANCELLABLE` | Task has already completed or cannot be cancelled |

---

## Troubleshooting

| Issue                           | Symptom                                 | Solution                                                     |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Actions stuck in pending        | No handler processes action             | Check if handler is registered; reminder type has no handler |
| Pub/Sub delivery failures       | Actions not processed                   | Verify topic name matches `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`  |
| Type correction not working     | Action stays same type after PATCH      | Ensure action is in `pending` or `awaiting_approval` status  |
| Batch returns wrong actions     | Actions from other users                | Security check filters by userId; verify correct IDs         |
| WhatsApp notifications not sent | Action completes silently               | Check `whatsapp-send` topic configuration                    |
| WhatsApp approval not working   | Text reply ignored, buttons re-sent     | Expected behavior in v4.0.0 -- tap a button instead          |
| Race condition errors           | Duplicate notifications                 | System handles this automatically with `updateStatusIf`      |
| Calendar preview returns null   | No preview available                    | Preview may have failed; check calendar-agent logs           |
| Code task worker unavailable    | Action marked as failed                 | code-agent has no available workers; retry later             |
| Duplicate code task             | Already exists message                  | Task was already created (idempotent via approvalEventId)    |
| Interactive buttons not showing | Plain text message instead of buttons   | WhatsApp client may not support interactive messages         |
| Action deleted, approval fails  | WhatsApp message: "no longer available" | Action was deleted or expired; this is handled gracefully    |
| Proceed implementation fails    | Error message about status/labels       | Task must be in designed status with required Linear labels  |

---

## Exercises

### Easy

1. List all your completed actions
2. Find actions created in the last 24 hours using status filtering
3. Archive an old action you no longer need

### Medium

1. Create a batch request to fetch 10 specific action IDs
2. Change an action type from `link` to `todo` and verify the transition was logged
3. Send a command via WhatsApp and approve it by tapping the button

### Hard

1. Implement a retry mechanism for failed actions using the `/internal/actions/retry-pending` endpoint
2. Build a dashboard that polls for action status updates
3. Test the race condition protection by sending multiple rapid approval button taps

<details>
<summary>Solutions</summary>

### Exercise 1 (Easy): List Completed Actions

```bash
curl -X GET "https://actions-agent.intexuraos.com/actions?status=completed" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Exercise 2 (Medium): Batch Fetch

```bash
curl -X POST https://actions-agent.intexuraos.com/actions/batch \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actionIds": ["id1", "id2", "id3", "id4", "id5", "id6", "id7", "id8", "id9", "id10"]}'
```

### Exercise 3 (Hard): Race Condition Test

```
Scenario: Two WhatsApp approval button taps arrive simultaneously

Thread 1: updateStatusIf('pending', 'awaiting_approval')
Thread 2: updateStatusIf('pending', 'awaiting_approval')

Firestore Transaction:
  Thread 1: Reads status='awaiting_approval', matches expected, updates to 'pending'
  Thread 2: Reads status='pending', does NOT match expected, returns status_mismatch

Result: Only one approval is processed, no duplicate notifications
```

</details>

---

## Next Steps

1. Explore the [Technical Reference](technical.md) for full API details and domain model documentation
2. Read about the [approval flow architecture](technical.md#handleapprovalreply-v200-redesigned-in-v400-extended-in-v410) for deeper understanding
3. Check the [Agent Interface](agent.md) for machine-readable integration specs
