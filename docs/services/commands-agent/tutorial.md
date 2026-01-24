# Commands Agent - Tutorial

This tutorial demonstrates command classification with the v2.0.0 improvements: URL keyword isolation, explicit intent detection, and Polish language support.

## Prerequisites

- Auth0 access token
- Google API key or Zai API key configured in user-service
- `curl` or HTTP client

## Part 1: Basic Classification

Create a simple todo command:

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Buy groceries",
    "source": "pwa-shared"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "command": {
      "id": "pwa-shared:1706097600000-abc123",
      "status": "classified",
      "classification": {
        "type": "todo",
        "confidence": 0.92,
        "reasoning": "Clear actionable task with no time specification",
        "classifiedAt": "2026-01-24T12:00:01.000Z"
      },
      "actionId": "uuid-here"
    }
  }
}
```

**Checkpoint:** Status is `classified`, type is `todo`, confidence is high (0.90+).

## Part 2: URL Keyword Isolation (v2.0.0)

Test that keywords in URLs don't trigger incorrect classification:

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "https://research-world.com/article",
    "source": "pwa-shared"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "command": {
      "classification": {
        "type": "link",
        "confidence": 0.95,
        "reasoning": "URL present, keyword 'research' in URL ignored per isolation rules"
      }
    }
  }
}
```

**Key Point:** Despite "research" in the URL, classification is `link` because Step 4 (URL presence) triggers before keyword matching, and the prompt's URL keyword isolation rule prevents the LLM from being misled.

## Part 3: Explicit Intent Override (v2.0.0)

Test that explicit command phrases override URL presence:

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "research this https://example.com/competitor",
    "source": "pwa-shared"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "command": {
      "classification": {
        "type": "research",
        "confidence": 0.92,
        "reasoning": "Explicit 'research this' intent detected, overrides URL presence"
      }
    }
  }
}
```

**Key Point:** Step 2 (explicit intent "research this") executes before Step 4 (URL presence), so the command is queued for research rather than saved as a bookmark.

## Part 4: Polish Language Support (v2.0.0)

Test native Polish command phrases:

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "zapisz link https://example.com",
    "source": "pwa-shared"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "command": {
      "classification": {
        "type": "link",
        "confidence": 0.92,
        "reasoning": "Polish explicit intent 'zapisz link' (save link) detected"
      }
    }
  }
}
```

More Polish examples:

```bash
# Create todo in Polish
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "stwórz zadanie: kupić mleko", "source": "pwa-shared"}'
# → type: todo, confidence: 0.90+

# Research in Polish
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "zbadaj najnowsze trendy AI", "source": "pwa-shared"}'
# → type: research, confidence: 0.90+
```

## Part 5: Explicit Prefix Override

Override classification with explicit prefix:

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "linear: buy groceries",
    "source": "pwa-shared"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "command": {
      "classification": {
        "type": "linear",
        "confidence": 0.95,
        "reasoning": "Explicit 'linear:' prefix detected, user override"
      }
    }
  }
}
```

**Key Point:** Step 1 (explicit prefix) takes absolute priority. Even though "buy groceries" would normally be a todo, the prefix forces Linear classification.

## Part 6: Graceful Degradation

When no API key is configured, commands enter pending state:

```bash
# Assuming user has no Google/Zai API key configured
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Test command without API key",
    "source": "pwa-shared"
  }'
```

**Response:**

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

**Solution:** Configure API key in user-service. Cloud Scheduler calls `/internal/retry-pending` every 5 minutes to process pending commands.

## Part 7: Command Lifecycle Management

### List commands

```bash
curl https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Delete unclassified command

```bash
curl -X DELETE https://commands-agent.intexuraos.com/commands/pwa-shared:123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Only works for status: `received`, `pending_classification`, or `failed`.

### Archive classified command

```bash
curl -X PATCH https://commands-agent.intexuraos.com/commands/pwa-shared:456 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}'
```

Only works for status: `classified`.

## Troubleshooting

| Symptom                            | Cause                       | Solution                                    |
| ---------------------------------- | --------------------------- | ------------------------------------------- |
| Status `pending_classification`    | No LLM API key              | Configure Google or Zai key in user-service |
| URL classified as `research`       | Old prompt version          | Ensure v2.0.0 prompt deployed               |
| Polish phrases not recognized      | Old prompt version          | Ensure v2.0.0 prompt deployed               |
| "Cannot delete classified command" | Wrong operation             | Use PATCH to archive instead                |
| Status `failed`                    | LLM error or actions-agent  | Check logs, delete and retry                |
| Duplicate command (isNew: false)   | Same externalId reprocessed | Normal idempotency behavior                 |

## Exercises

### Easy

1. Create commands for each type: todo, research, note, link
2. Verify confidence scores match the semantics table
3. Archive a classified command

### Medium

1. Test URL keyword isolation with various misleading URLs
2. Test Polish commands for all supported categories
3. Simulate pending_classification and wait for retry

### Hard

1. Publish a `command.ingest` event via Pub/Sub
2. Test idempotency by sending the same externalId twice
3. Build a retry loop for failed commands

---

**Last updated:** 2026-01-24
