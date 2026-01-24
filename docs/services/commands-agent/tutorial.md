# Commands Agent - Tutorial

This tutorial shows how to integrate with commands-agent for intelligent command classification.

## Prerequisites

- Auth0 access token for authenticated requests
- Google API key configured in user-service (for classification)
- Familiarity with HTTP APIs and JSON

## Part 1: Hello World - Simple Command

Create your first command via the public API:

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Remember to buy milk",
    "source": "pwa-shared"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "command": {
      "id": "pwa-shared:1234567890-abc123",
      "userId": "user_123",
      "sourceType": "pwa-shared",
      "externalId": "1234567890-abc123",
      "text": "Remember to buy milk",
      "timestamp": "2026-01-13T12:00:00.000Z",
      "status": "classified",
      "classification": {
        "type": "todo",
        "confidence": 0.95,
        "reasoning": "User wants to remember a task, which maps to a todo item",
        "classifiedAt": "2026-01-13T12:00:01.000Z"
      },
      "actionId": "uuid-here",
      "createdAt": "2026-01-13T12:00:00.000Z",
      "updatedAt": "2026-01-13T12:00:01.000Z"
    }
  }
}
```

**What happened:**

1. Command received and saved to Firestore
2. Gemini classified as "todo" with 95% confidence
3. Action created via actions-agent
4. `action.created` event published to Pub/Sub
5. Command marked as "classified"

**Checkpoint:** You should see the command status as `classified` with an `actionId`.

## Part 2: Create Commands from Webhook

For services like whatsapp-service, publish a Pub/Sub event:

```bash
gcloud pubsub topics publish command-ingest \
  --message='{
    "type": "command.ingest",
    "userId": "user_123",
    "sourceType": "whatsapp_text",
    "externalId": "wamid.xxx",
    "text": "Research the latest AI trends",
    "timestamp": "2026-01-13T12:00:00.000Z"
  }'
```

**Expected:** Commands-agent receives via push subscription, processes asynchronously.

## Part 3: Handle Errors

### Error: No API Key Configured

**Request:**

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Test command",
    "source": "pwa-shared"
  }'
```

**Response (when no Google API key):**

```json
{
  "success": true,
  "data": {
    "command": {
      "status": "pending_classification",
      "classification": null
    }
  }
}
```

**Solution:** User must configure Google API key via user-service. Cloud Scheduler will retry pending commands.

### Error: Cannot Delete Classified Command

```bash
curl -X DELETE https://commands-agent.intexuraos.com/commands/pwa-shared:123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Cannot delete classified command. Use archive instead."
  }
}
```

**Solution:** Use PATCH to archive instead:

```bash
curl -X PATCH https://commands-agent.intexuraos.com/commands/pwa-shared:123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}'
```

## Part 4: Real-World Scenario

Build a WhatsApp integration that creates commands:

```typescript
// WhatsApp webhook handler
async function handleWhatsAppMessage(message: WhatsAppMessage) {
  const userId = await getUserByPhoneNumber(message.from);

  // Publish to commands-agent
  await pubsubClient.topic('command-ingest').publishMessage({
    data: Buffer.from(
      JSON.stringify({
        type: 'command.ingest',
        userId,
        sourceType: 'whatsapp_text',
        externalId: message.id,
        text: message.text.body,
        timestamp: message.timestamp,
      })
    ),
  });

  // Quick response
  await sendWhatsAppMessage(message.from, 'Processing your command...');
}
```

**Idempotency:** If WhatsApp delivers the same message twice (same `message.id`), commands-agent returns the existing command.

## Troubleshooting

| Issue                  | Symptom                         | Solution                                   |
| ---------------------- | ------------------------------- | ------------------------------------------ |
| No API key             | Status `pending_classification` | Configure Google API key in user-service   |
| Low confidence         | Type `unclassified`             | Refine command text with more context      |
| Duplicate command      | `isNew: false`                  | Normal - same externalId already processed |
| Action creation failed | Status `failed`                 | Check actions-agent logs                   |

## Exercises

### Easy

1. Create a command with source `pwa-shared`
2. List your commands and verify status
3. Archive a classified command

### Medium

1. Send a command mentioning specific models ("Use Claude for research")
2. Verify the action was created with selectedModels in payload
3. Delete a pending_classification command

### Hard

1. Simulate a Pub/Sub push to `/internal/commands`
2. Handle the case where command already exists (idempotency)
3. Build a retry loop for failed commands
