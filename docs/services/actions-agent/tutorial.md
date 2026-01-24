# Actions Agent - Tutorial

This tutorial will help you get started with the actions-agent service, from basic listing to advanced action management.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests
- Familiarity with HTTP clients (curl, Postman, or similar)

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
        "status": "completed",
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

## Part 2: Update an Action Status

Update an action's status to manually approve, reject, or archive it.

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

## Part 3: Handle Errors

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

## Part 4: Real-World Scenario - Duplicate Link Resolution

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

## Troubleshooting

| Issue                           | Symptom                            | Solution                                                                 |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Actions stuck in pending        | No handler processes action        | Check if handler is registered; calendar/reminder types have no handlers |
| Pub/Sub delivery failures       | Actions not processed              | Verify topic name matches `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`              |
| Type correction not working     | Action stays same type after PATCH | Ensure action is in `pending` or `awaiting_approval` status              |
| Batch returns wrong actions     | Actions from other users           | Security check filters by userId; verify correct IDs                     |
| WhatsApp notifications not sent | Action completes silently          | Check `whatsapp-send` topic configuration                                |

## Exercises

### Easy

1. List all your completed actions
2. Find actions created in the last 24 hours
3. Archive an old action you no longer need

### Medium

1. Create a batch request to fetch 10 specific action IDs
2. Change an action type from `link` to `todo` and verify the transition was logged
3. Delete an action and confirm it's removed

### Hard

1. Implement a retry mechanism for failed actions using the `/internal/actions/retry-pending` endpoint
2. Build a dashboard that polls for action status updates
3. Create a script to bulk-update action statuses based on criteria
