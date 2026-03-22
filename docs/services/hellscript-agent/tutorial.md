# Hellscript Agent — Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** Node.js 20+, GCP project access, valid JWT token
> **You'll learn:** How to create a writing buffer, impose thoughts, and generate drafts

---

## What You'll Build

A working integration that:

- Creates a new writing buffer by sending the first utterance
- Accumulates thoughts, writing samples, and style preferences
- Generates a versioned markdown draft from accumulated state
- Retrieves the full buffer workspace

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS project
- [ ] A valid Bearer token (JWT from Auth0)
- [ ] `curl` or similar HTTP client

---

## Part 1: Your First Impose (5 minutes)

The core operation in Hellscript is "impose" — sending an utterance to a buffer. If no buffer ID is provided, a new buffer is created automatically.

### Step 1.1: Send Your First Thought

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "utterance": "The key insight is that event sourcing decouples reads from writes"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "bufferId": "abc123...",
    "action": "append_thought"
  }
}
```

### What Just Happened?

1. A new buffer was created (since no `bufferId` was provided)
2. Gemini 2.5 Flash interpreted your utterance as an `append_thought` intent
3. The thought was added to the buffer's materialized state
4. The event was recorded in the buffer's event subcollection

**Save the `bufferId`** from the response — you will use it in subsequent requests.

---

## Part 2: Build Up Your Buffer (5 minutes)

### Step 2.1: Add More Thoughts

```bash
BUFFER_ID="<your-buffer-id>"

curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Include a comparison table showing throughput before and after\"
  }"
```

### Step 2.2: Set Style Preferences

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Write in a technical but accessible tone, aimed at senior engineers\"
  }"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "bufferId": "abc123...",
    "action": "set_style_instructions"
  }
}
```

Notice the action changed to `set_style_instructions` — the LLM recognized this as a style directive rather than a content thought.

### Step 2.3: Check Your Buffer

```bash
curl https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/buffers/$BUFFER_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Checkpoint:** The response should contain your buffer with `eventCount: 3`, a list of events, and a `state` object showing your thoughts and style instructions.

---

## Part 3: Generate a Draft (5 minutes)

### Step 3.1: Request a Draft

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Write the draft now\"
  }"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "bufferId": "abc123...",
    "action": "update_draft",
    "latestDraftVersionId": "draft456..."
  }
}
```

### Step 3.2: View the Draft

Retrieve the workspace to see your generated draft:

```bash
curl https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/buffers/$BUFFER_ID \
  -H "Authorization: Bearer $TOKEN"
```

The `draftVersions` array now contains version 1 with the generated markdown.

### Step 3.3: Iterate

Add another thought and request a new draft — the agent generates version 2, incorporating the new material while building on the previous draft:

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Also mention that the migration took only two sprints\"
  }"

curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Update the draft\"
  }"
```

**Checkpoint:** The workspace now shows two draft versions. The buffer's `latestDraftVersionNumber` is `2`.

---

## Part 4: List Your Buffers (2 minutes)

```bash
curl https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/hellscript/buffers \
  -H "Authorization: Bearer $TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "abc123...",
      "userId": "user-xyz",
      "title": "The key insight is that event sourcing decouples reads from writ...",
      "eventCount": 6,
      "latestDraftVersionNumber": 2,
      "latestDraftVersionId": "draft789...",
      "createdAt": "2026-03-22T10:00:00.000Z",
      "updatedAt": "2026-03-22T10:05:00.000Z"
    }
  ]
}
```

Notice the title was automatically derived from your first thought.

---

## Troubleshooting

| Problem                          | Solution                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| `401 Unauthorized`               | Check your Bearer token is valid and not expired                   |
| `404 Buffer not found`           | Verify the buffer ID is correct and belongs to your user           |
| `action: "update_draft_failed"`  | Draft generation LLM call failed; your thoughts are still saved    |
| `action: "fallback_append"`      | The LLM could not interpret intent; utterance was saved as thought |
| `500 Internal Error`             | Check service health at `/health`; retry with backoff              |

---

## Next Steps

Now that you understand the basics:

1. Explore the web UI at `/#/hellscript` for a conversational interface with timeline and draft pane
2. Read the [Technical Reference](technical.md) for full API and domain model details
3. Try providing writing samples to influence draft style

---

## Exercises

Test your understanding:

1. **Easy:** Create a buffer, add 3 thoughts, and list your buffers to verify
2. **Medium:** Set metadata (audience and content goal) before generating a draft — observe how the draft content changes
3. **Hard:** Build a buffer with a writing sample, style instructions, audience, content goal, and 5 thoughts, then generate two draft versions and compare them

<details>
<summary>Solutions</summary>

### Exercise 1: Three Thoughts

```bash
# First thought creates the buffer
RESPONSE=$(curl -s -X POST .../hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"utterance": "First idea"}')

BUFFER_ID=$(echo $RESPONSE | jq -r '.data.bufferId')

# Second and third thoughts
curl -s -X POST .../hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"Second idea\"}"

curl -s -X POST .../hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"Third idea\"}"

# Verify
curl -s .../hellscript/buffers -H "Authorization: Bearer $TOKEN" | jq
```

### Exercise 2: Metadata Before Draft

```bash
curl -s -X POST .../hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"The audience is junior developers\"}"

curl -s -X POST .../hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"The goal is a getting-started tutorial\"}"

curl -s -X POST .../hellscript/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"Write the draft\"}"
```

### Exercise 3: Full Buffer

Build up incrementally using the impose endpoint with different utterance types, then request `update_draft` twice. Compare `draftVersions[0].markdown` with `draftVersions[1].markdown` in the workspace response.

</details>
