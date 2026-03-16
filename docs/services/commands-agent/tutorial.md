# Commands Agent — Tutorial

> **Time:** 20–30 minutes
> **Prerequisites:** Node.js 20+, access to a running IntexuraOS environment, valid Auth0 bearer token
> **You'll learn:** How to submit commands, read classification results, archive completed commands, and trigger a retry for pending classifications

---

## What You'll Build

A working integration that:

- Creates a command from the PWA and reads its classification
- Handles the pending state when no LLM API key is available
- Archives a classified command after acting on it
- Calls the retry endpoint to flush stuck commands

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS dev environment (`dev.intexuraos.cloud`)
- [ ] A valid Auth0 bearer token (obtain from the web app session or Auth0 test client)
- [ ] `curl` and `jq` installed locally
- [ ] Basic understanding of how Pub/Sub push endpoints work (optional — the PWA path avoids Pub/Sub entirely)

---

## Part 1: Hello World — Create a Command (5 minutes)

Let's start with the simplest possible interaction: create a command from the PWA and see what classification comes back.

### Step 1.1: Create a command

```bash
export TOKEN="your-bearer-token-here"
export BASE="https://commands-agent.dev.intexuraos.cloud"

curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Create a todo to review the Q1 report", "source": "pwa-shared"}' \
  | jq .
```

**Expected response (201):**

```json
{
  "success": true,
  "data": {
    "command": {
      "id": "pwa-shared:1710000000000-abc1234",
      "userId": "auth0|...",
      "sourceType": "pwa-shared",
      "externalId": "1710000000000-abc1234",
      "text": "Create a todo to review the Q1 report",
      "timestamp": "2026-03-15T10:00:00.000Z",
      "status": "classified",
      "classification": {
        "type": "todo",
        "confidence": 0.95,
        "reasoning": "Explicit 'create a todo' instruction detected — Step 2 override.",
        "promptVersion": "2.1.0",
        "classifiedAt": "2026-03-15T10:00:01.234Z"
      },
      "actionId": "action-uuid-here",
      "createdAt": "2026-03-15T10:00:00.123Z",
      "updatedAt": "2026-03-15T10:00:01.456Z"
    }
  }
}
```

### What Just Happened?

The service ran the 5-step classification prompt against your text. It detected "Create a todo" in Step 2 (explicit intent override) and assigned type `todo` with high confidence. It then called actions-agent to create the action, stored the action ID on the command, and returned both together.

Note the `id` format: `pwa-shared:{externalId}`. This composite key is the deduplication mechanism — if you post the same `externalId` twice, the second call returns the existing command unchanged.

---

## Part 2: Read and Understand Classification Results (5 minutes)

### Step 2.1: List your commands

```bash
curl -s "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data.commands[] | {id, status, type: .classification.type, confidence: .classification.confidence}'
```

**Expected output:**

```json
{
  "id": "pwa-shared:1710000000000-abc1234",
  "status": "classified",
  "type": "todo",
  "confidence": 0.95
}
```

### Step 2.2: Try different input types

Test the classification logic with different inputs:

```bash
# Research task — via explicit intent phrase
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "investigate competitor pricing trends for Q2", "source": "pwa-shared"}' \
  | jq '.data.command.classification'

# Link — URL presence triggers link classification
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "https://example.com/article-about-pricing", "source": "pwa-shared"}' \
  | jq '.data.command.classification'

# Ambiguous — explicit instruction wins over URL keywords
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "create a todo to research https://example.com", "source": "pwa-shared"}' \
  | jq '.data.command.classification.type'
# Expected: "todo" (not "research", not "link")
```

**Checkpoint:** The third command should return `"todo"` — the explicit "create a todo" instruction wins over both URL presence and the word "research."

---

## Part 3: Manage Command Lifecycle (10 minutes)

### Step 3.1: Archive a classified command

Once you have acted on a classified command, archive it to keep your list clean:

```bash
export CMD_ID="pwa-shared:1710000000000-abc1234"

curl -s -X PATCH "$BASE/commands/$CMD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}' \
  | jq '.data.command.status'
# Expected: "archived"
```

**Important:** Only commands with status `classified` can be archived. Attempting to archive a `received` or `failed` command returns a 400 error.

### Step 3.2: Delete an unclassified command

Commands that are still in `received`, `pending_classification`, or `failed` state can be deleted:

```bash
# Provide an explicit externalId to control the command ID
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "delete me", "source": "pwa-shared", "externalId": "test-delete-1"}' \
  | jq '.data.command.status'

curl -s -X DELETE "$BASE/commands/pwa-shared:test-delete-1" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.success'
# Expected: true
```

### Step 3.3: Understand delete vs archive restrictions

| Status                   | Can Delete? | Can Archive? |
| ------------------------ | ----------- | ------------ |
| `received`               | Yes         | No           |
| `pending_classification` | Yes         | No           |
| `failed`                 | Yes         | No           |
| `classified`             | No          | Yes          |
| `archived`               | No          | No           |

---

## Part 4: Trigger Pending Retry (5 minutes)

Commands enter `pending_classification` status when the LLM API key is not available at processing time. Cloud Scheduler triggers the retry endpoint automatically, but you can also call it manually.

### Step 4.1: Call the retry endpoint

This is an internal endpoint — it requires the `X-Internal-Auth` header, not a bearer token:

```bash
export INTERNAL_TOKEN="your-internal-auth-token"

curl -s -X POST "$BASE/internal/retry-pending" \
  -H "X-Internal-Auth: $INTERNAL_TOKEN" \
  | jq '.data'
```

**Expected response:**

```json
{
  "processed": 3,
  "skipped": 1,
  "failed": 0,
  "total": 4
}
```

### What Each Field Means

| Field       | Meaning                                                  |
| ----------- | -------------------------------------------------------- |
| `processed` | Commands successfully classified and action created      |
| `skipped`   | Commands skipped because LLM client fetch still fails    |
| `failed`    | Commands where classification or action creation errored |
| `total`     | Total pending commands found before processing           |

---

## Part 5: Real-World Scenario — Ingest via Pub/Sub (10 minutes)

The primary production path is Pub/Sub push from whatsapp-service. Here is how to simulate it directly.

### Step 5.1: Build the event payload

Pub/Sub push delivers a base64-encoded JSON body. Build it:

```typescript
const event = {
  type: 'command.ingest',
  userId: 'auth0|your-user-id',
  sourceType: 'whatsapp_text',
  externalId: 'wamid.test-abc123',
  text: 'zbadaj najnowsze trendy w logistyce ostatniej mili',
  timestamp: new Date().toISOString(),
};

const encoded = Buffer.from(JSON.stringify(event)).toString('base64');
console.log(encoded);
```

### Step 5.2: Send the simulated Pub/Sub push

```bash
export ENCODED="<base64 from step above>"

curl -s -X POST "$BASE/internal/commands" \
  -H "X-Internal-Auth: $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"data\": \"$ENCODED\",
      \"messageId\": \"test-msg-001\",
      \"publishTime\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    },
    \"subscription\": \"projects/intexuraos-dev/subscriptions/commands-agent\"
  }" \
  | jq .
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "commandId": "whatsapp_text:wamid.test-abc123",
    "isNew": true
  }
}
```

### Step 5.3: Confirm classification via internal lookup

```bash
curl -s "$BASE/internal/commands/whatsapp_text:wamid.test-abc123" \
  -H "X-Internal-Auth: $INTERNAL_TOKEN" \
  | jq '.data.command'
```

The Polish phrase "zbadaj" (investigate) should produce `"type": "research"` — the system recognizes this as an explicit intent phrase in Step 2 without any translation step.

---

## Troubleshooting

| Problem                                           | Solution                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `401 Unauthorized`                                | Check your bearer token is valid and not expired                                               |
| `400 Cannot delete classified`                    | Use `PATCH` with `status: "archived"` instead of `DELETE` for classified commands              |
| `400 Can only archive classified`                 | Command is not in `classified` status — check current status first with `GET /commands`        |
| `404 Command not found`                           | Verify the command ID format: `{sourceType}:{externalId}`                                      |
| Stuck in `pending_classification`                 | LLM API key not configured for that user — call `/internal/retry-pending` after key is added   |
| Classification returns `note` with low confidence | LLM response was unparseable — check classifier logs for raw response preview                  |
| Second POST returns same command                  | Duplicate `externalId` — this is expected idempotent behavior                                  |

---

## Next Steps

Now that you understand the command lifecycle:

1. Explore the classification prompt logic in `packages/llm-prompts/src/classification/commandClassifierPrompt.ts` — modify Step 5 category signals to add new language support
2. Read the [Technical Reference](technical.md) for full API details and the confidence semantics table
3. Check out [actions-agent](../actions-agent/features.md) to understand what happens after a command is classified

---

## Exercises

Test your understanding:

1. **Easy:** Create a command with Polish text "stworz zadanie: kupic mleko" and verify it classifies as `todo`
2. **Medium:** Create a command with text "research this https://example.com/report" and verify it classifies as `research` (not `link`) — explain why based on the 5-step process
3. **Hard:** Submit the same command twice using the same `externalId` and verify the command ID is identical on both responses

<details>
<summary>Solutions</summary>

### Exercise 1: Polish todo

```bash
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "stworz zadanie: kupic mleko", "source": "pwa-shared"}' \
  | jq '.data.command.classification.type'
# Expected: "todo"
```

"stworz zadanie" is a Step 1 explicit prefix match in Polish.

### Exercise 2: Explicit intent overrides URL

```bash
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "research this https://example.com/report", "source": "pwa-shared"}' \
  | jq '.data.command.classification.type'
# Expected: "research"
```

"research this" matches the Step 2 explicit intent phrase list with confidence 0.90+. Step 4 (URL presence) is only reached when no explicit intent was found. Step 2 fires first and wins.

### Exercise 3: Idempotency

```bash
EXTERNAL_ID="dedup-test-$(date +%s)"

# First call
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"buy milk\", \"source\": \"pwa-shared\", \"externalId\": \"$EXTERNAL_ID\"}" \
  | jq '.data.command.id'

# Second call — same externalId
curl -s -X POST "$BASE/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"buy milk\", \"source\": \"pwa-shared\", \"externalId\": \"$EXTERNAL_ID\"}" \
  | jq '.data.command.id'
# Both calls return the same id: "pwa-shared:<EXTERNAL_ID>"
```

The `processCommand` use case calls `commandRepository.getById` first. If the composite key already exists, it returns the existing record immediately without re-classifying.

</details>
