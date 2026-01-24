# Actions Agent - Tutorial

This tutorial will help you get started with the actions-agent service, from basic listing to advanced action management including the new WhatsApp approval workflow.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests
- Familiarity with HTTP clients (curl, Postman, or similar)
- (For WhatsApp approvals) A configured LLM API key in user-service

## Part 1: Hello World - List Your Actions

The simplest interaction is listing actions for the authenticated user.

### Step 1: Get your access token

First, authenticate with Auth0 to get an access token:

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

### Step 2: List your actions

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

### Checkpoint

You should see a list of your actions. Try filtering by status:

```bash
curl -X GET "https://actions-agent.intexuraos.com/actions?status=pending,awaiting_approval" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 2: WhatsApp Approval Workflow (New in v2.0.0)

The most powerful feature of actions-agent is approving actions directly via WhatsApp replies.

### How It Works

1. Send a command via WhatsApp: "Research machine learning trends"
2. Receive an approval notification: "New research ready for approval: 'Research machine learning trends'. Review here: [link] or reply to approve/reject."
3. Reply "yes" to approve or "no" to reject
4. Receive confirmation: "Approved! Processing your research..."

### Understanding the Flow

```
You: "Research machine learning trends"
Bot: "New research ready for approval: 'Research machine learning trends'.
      Review here: https://app.intexuraos.com/#/inbox?action=abc123
      or reply to approve/reject."
You: "yes please"
Bot: "Approved! Processing your research: 'Research machine learning trends'"
[Later]
Bot: "Your research is ready! View it here: [link]"
```

### Intent Classification

The LLM understands natural language, so you can reply:

**Approval phrases:**

- "yes", "yep", "ok", "approve", "go ahead", "do it", "sounds good"

**Rejection phrases:**

- "no", "nope", "cancel", "reject", "don't", "skip", "never mind"

**Unclear phrases (will ask for clarification):**

- "maybe", "what is this?", "huh?"

### Checkpoint

Send a command via WhatsApp and practice approving/rejecting via reply.

## Part 3: Update an Action Status

Update an action's status to manually approve, reject, or archive it (alternative to WhatsApp).

### Approve an action

Move an action from `awaiting_approval` to `processing`:

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

## Part 4: Execute an Action

Execute an action synchronously (useful for testing or immediate execution).

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

## Part 5: Handle Errors

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

**Cause:** The action doesn't exist or belongs to another user.

**Solution:** Verify the action ID and that you're authenticated as the owner.

### Error: Unauthorized (401)

```json
{
  "error": "Unauthorized"
}
```

**Cause:** Missing or invalid `X-Internal-Auth` header for internal endpoints.

**Solution:** Ensure the shared secret is correctly set in environment variables.

### Error: Action type mismatch

When processing Pub/Sub events, if the URL action type doesn't match the event:

```json
{
  "error": "Action type mismatch"
}
```

**Cause:** Routing configuration error or malformed event.

**Solution:** Verify Pub/Sub subscription endpoints match action types.

### Error: LLM API key not configured (v2.0.0)

When using WhatsApp approval replies without a configured LLM key:

```
"I couldn't process your reply because your LLM API key is not configured.
Please add your API key in settings, then try again."
```

**Solution:** Configure your LLM API key in user-service settings.

## Part 6: Real-World Scenario - Duplicate Link Resolution

When creating a bookmark action, if the URL already exists, the action fails with an `existingBookmarkId` in the payload. Here's how to handle it:

### Step 1: Check the failed action

```bash
curl -X GET https://actions-agent.intexuraos.com/actions/ACTION_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Look for `payload.existingBookmarkId`.

### Step 2: Choose resolution

**Skip (reject the new link):**

```bash
curl -X POST https://actions-agent.intexuraos.com/actions/ACTION_ID/resolve-duplicate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "skip"}'
```

**Update (refresh existing bookmark with new metadata):**

```bash
curl -X POST https://actions-agent.intexuraos.com/actions/ACTION_ID/resolve-duplicate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "update"}'
```

## Part 7: Calendar Action Preview

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
      "reasoning": "Parsed 'Team standup tomorrow at 9am' with 30-minute default duration",
      "generatedAt": "2026-01-24T10:00:00Z"
    }
  }
}
```

## Troubleshooting

| Issue                           | Symptom                            | Solution                                                     |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| Actions stuck in pending        | No handler processes action        | Check if handler is registered; reminder type has no handler |
| Pub/Sub delivery failures       | Actions not processed              | Verify topic name matches `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`  |
| Type correction not working     | Action stays same type after PATCH | Ensure action is in `pending` or `awaiting_approval` status  |
| Batch returns wrong actions     | Actions from other users           | Security check filters by userId; verify correct IDs         |
| WhatsApp notifications not sent | Action completes silently          | Check `whatsapp-send` topic configuration                    |
| WhatsApp approval not working   | Reply not processed                | Ensure LLM API key is configured in user-service             |
| Race condition errors           | Duplicate notifications            | System handles this automatically with `updateStatusIf`      |
| Calendar preview returns null   | No preview available               | Wait for calendar-agent to generate preview                  |

## Exercises

### Easy

1. List all your completed actions
2. Find actions created in the last 24 hours
3. Archive an old action you no longer need

### Medium

1. Create a batch request to fetch 10 specific action IDs
2. Change an action type from `link` to `todo` and verify the transition was logged
3. Send a command via WhatsApp and approve it via reply

### Hard

1. Implement a retry mechanism for failed actions using the `/internal/actions/retry-pending` endpoint
2. Build a dashboard that polls for action status updates
3. Test the race condition protection by sending multiple rapid approval replies

## Understanding Race Condition Protection

The v2.0.0 release introduced atomic status transitions to prevent race conditions. Here's what happens:

```
Scenario: Two WhatsApp approval replies arrive simultaneously

Thread 1: updateStatusIf('pending', 'awaiting_approval')
Thread 2: updateStatusIf('pending', 'awaiting_approval')

Firestore Transaction:
  Thread 1: Reads status='awaiting_approval', matches expected, updates to 'pending'
  Thread 2: Reads status='pending', does NOT match expected, returns status_mismatch

Result: Only one approval is processed, no duplicate notifications
```

This ensures reliable behavior even under heavy load or network delays.
