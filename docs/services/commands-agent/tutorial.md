# Commands Agent - Tutorial

> **Time:** 15-30 minutes
> **Prerequisites:** Auth0 access token, Google or Zai API key configured in user-service, `curl` or HTTP client
> **You'll learn:** How to classify commands, handle URL isolation, use Polish phrases, and manage command lifecycle

---

## What You'll Build

A working integration that:

- Classifies natural language into action types (todo, research, link, code, etc.)
- Handles URL keyword isolation correctly
- Supports Polish command phrases
- Manages the full command lifecycle (create, list, archive, delete)

---

## Part 1: Basic Classification (5 minutes)

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
        "promptVersion": "2.0.0",
        "classifiedAt": "2026-01-24T12:00:01.000Z"
      },
      "actionId": "uuid-here"
    }
  }
}
```

**Checkpoint:** Status is `classified`, type is `todo`, confidence is high (0.90+).

---

## Part 2: URL Keyword Isolation (5 minutes)

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

---

## Part 3: Explicit Intent Override (5 minutes)

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

---

## Part 4: Polish Language Support (5 minutes)

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
  -d '{"text": "stworz zadanie: kupic mleko", "source": "pwa-shared"}'
# -> type: todo, confidence: 0.90+

# Research in Polish
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "zbadaj najnowsze trendy AI", "source": "pwa-shared"}'
# -> type: research, confidence: 0.90+
```

---

## Part 5: Code Command Classification (5 minutes)

Test that programming-related commands classify as `code`:

```bash
curl -X POST https://commands-agent.intexuraos.com/commands \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "fix the login bug in the auth module",
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
        "type": "code",
        "confidence": 0.92,
        "reasoning": "Programming-related command detected: fix bug"
      }
    }
  }
}
```

**Key Point:** Commands with programming context (fix, refactor, debug, implement, deploy) classify as `code` rather than generic `todo`.

---

## Part 6: Explicit Prefix Override (5 minutes)

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

---

## Part 7: Graceful Degradation (5 minutes)

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

---

## Part 8: Command Lifecycle Management (5 minutes)

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

---

## Troubleshooting

| Symptom                            | Cause                       | Solution                                                |
| ---------------------------------- | --------------------------- | ------------------------------------------------------- |
| Status `pending_classification`    | No LLM API key              | Configure Google or Zai key in user-service             |
| URL classified as `research`       | Old prompt version          | Check `promptVersion` in response; redeploy if outdated |
| Polish phrases not recognized      | Old prompt version          | Check `promptVersion` in response; redeploy if outdated |
| "Cannot delete classified command" | Wrong operation             | Use PATCH to archive instead                            |
| Status `failed`                    | LLM error or actions-agent  | Check logs, delete and retry                            |
| Duplicate command (isNew: false)   | Same externalId reprocessed | Normal idempotency behavior                             |
| 401 Unauthorized                   | Expired or invalid token    | Refresh Auth0 access token                              |
| Classification falls back to note  | Title exceeded 200 chars    | Check LLM prompt; long titles are truncated by Zod      |

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for full API details and the classification prompt structure
2. Review the [Agent Interface](agent.md) for programmatic integration patterns
3. Check out [actions-agent](../actions-agent/features.md) to understand what happens after classification

---

## Exercises

### Easy

1. Create commands for each type: todo, research, note, link, code
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

<details>
<summary>Solutions</summary>

### Exercise 1: Commands for Each Type

```bash
# todo
curl -X POST .../commands -d '{"text": "Buy groceries", "source": "pwa-shared"}'
# research
curl -X POST .../commands -d '{"text": "How does OAuth 2.0 work?", "source": "pwa-shared"}'
# note
curl -X POST .../commands -d '{"text": "Note: meeting went well, follow up next week", "source": "pwa-shared"}'
# link
curl -X POST .../commands -d '{"text": "https://example.com/article", "source": "pwa-shared"}'
# code
curl -X POST .../commands -d '{"text": "Fix the login bug in auth module", "source": "pwa-shared"}'
```

### Exercise 2: Idempotency Test

```bash
# Send the same externalId twice
curl -X POST .../commands -d '{"text": "Test", "source": "pwa-shared", "externalId": "test-123"}'
# Second call returns isNew: false
curl -X POST .../commands -d '{"text": "Test", "source": "pwa-shared", "externalId": "test-123"}'
```

</details>

---

**Last updated:** 2026-03-07
