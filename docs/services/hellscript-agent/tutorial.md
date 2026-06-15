# Hellscript Agent — Tutorial

> **Time:** 20-25 minutes
> **Prerequisites:** Node.js 20+, GCP project access, valid JWT token
> **You'll learn:** How to create a writing buffer, impose thoughts, configure writing style per platform, and generate categorized drafts

---

## What You'll Build

A working integration that:

- Creates a new writing buffer by sending the first utterance
- Accumulates thoughts through multiple impose operations
- Configures platform-specific style instructions and writing samples
- Generates versioned markdown drafts with category-aware styling
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
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/impose \
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
2. The user's LLM client was resolved via user-service
3. The LLM interpreted your utterance as an `append_thought` intent
4. The thought was added to the buffer's materialized state
5. The event was recorded in the buffer's event subcollection

**Save the `bufferId`** from the response — you will use it in subsequent requests.

---

## Part 2: Build Up Your Buffer (5 minutes)

### Step 2.1: Add More Thoughts

```bash
BUFFER_ID="<your-buffer-id>"

curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Include a comparison table showing throughput before and after\"
  }"
```

### Step 2.2: Add a Third Thought

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"The migration took only two sprints thanks to the adapter pattern\"
  }"
```

### Step 2.3: Check Your Buffer

```bash
curl https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/buffers/$BUFFER_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Checkpoint:** The response should contain your buffer with `eventCount: 3`, a list of events, and a `state` object showing your three thoughts.

---

## Part 3: Configure Writing Style (5 minutes)

Before generating a draft, set up platform-specific writing preferences.

### Step 3.1: Set LinkedIn Style Instructions

```bash
curl -X PUT https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/writing-config/linkedin/style \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Professional but conversational tone. Use clear section headers. Target 800-1200 words. Include a hook in the first paragraph."
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "updated": true
  }
}
```

### Step 3.2: Add a Writing Sample

Upload a sample that represents your desired writing voice:

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/writing-config/linkedin/samples \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Previous architecture post",
    "text": "Last year we migrated our monolith to event-driven microservices. Here is what we learned, and why most migration guides get it wrong.\n\nThe conventional wisdom says start with the edges. We started with the core — and it worked better."
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "sample-uuid...",
    "category": "linkedin",
    "title": "Previous architecture post",
    "text": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### Step 3.3: Verify Your Configuration

```bash
curl https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/writing-config \
  -H "Authorization: Bearer $TOKEN"
```

**Checkpoint:** The response shows your LinkedIn style instructions. The `threads` and `general` fields are `null` since you have not configured them.

---

## Part 4: Generate a Draft (5 minutes)

### Step 4.1: Request a LinkedIn Draft

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Write the draft\",
    \"category\": \"linkedin\"
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

### What If Category Is Missing?

If you request a draft without specifying a category and the LLM cannot infer one from your utterance, you get:

```json
{
  "success": true,
  "data": {
    "bufferId": "abc123...",
    "action": "category_required"
  }
}
```

Re-send the impose with the `category` field to resolve this.

### Step 4.2: View the Draft

Retrieve the workspace to see your generated draft:

```bash
curl https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/buffers/$BUFFER_ID \
  -H "Authorization: Bearer $TOKEN"
```

The `draftVersions` array now contains version 1 with the generated markdown, styled according to your LinkedIn configuration.

### Step 4.3: Iterate

Add another thought and request a new draft — the agent generates version 2, incorporating the new material while building on the previous draft:

```bash
curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Also emphasize that we achieved zero downtime during the migration\"
  }"

curl -X POST https://intexuraos-hellscript-agent-cj44trunra-lm.a.run.app/impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"bufferId\": \"$BUFFER_ID\",
    \"utterance\": \"Update the draft\",
    \"category\": \"linkedin\"
  }"
```

**Checkpoint:** The workspace now shows two draft versions. The buffer's `latestDraftVersionNumber` is `2`.

---

## Part 5: Handle Errors (3 minutes)

### Common Error: Invalid Category

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid category. Must be threads, linkedin, or general."
  }
}
```

**Solution:** Use one of the three valid categories: `threads`, `linkedin`, or `general`.

### Common Error: Max Samples Exceeded

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Maximum 5 samples per category reached"
  }
}
```

**Solution:** Delete an existing sample before creating a new one.

### Common Error: Buffer Not Found

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Buffer not found"
  }
}
```

**Solution:** Verify the buffer ID is correct and belongs to your authenticated user.

### Common Error: LLM Client Resolution Failed

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to initialize LLM client. Please try again."
  }
}
```

**Solution:** This occurs when the user-service cannot resolve an LLM client for the user. Ensure the user has a valid Gemini API key configured, or that the platform fallback key (`INTEXURAOS_GEMINI_APP_API_KEY`) is set.

---

## Troubleshooting

| Problem                         | Solution                                                           |
| ------------------------------- | ------------------------------------------------------------------ |
| `401 Unauthorized`              | Check your Bearer token is valid and not expired                   |
| `404 Buffer not found`          | Verify the buffer ID is correct and belongs to your user           |
| `action: "category_required"`   | Re-send the impose with a `category` field                         |
| `action: "fallback_append"`     | The LLM could not interpret intent; utterance was saved as thought |
| `CONFLICT` on sample creation   | Delete an existing sample first (max 5 per category)               |
| `INTERNAL_ERROR` on impose      | LLM client resolution may have failed; check user config           |
| `500 Internal Error`            | Check service health at `/health`; retry with backoff              |

---

## Next Steps

Now that you understand the basics:

1. Explore the web UI at `/#/hellscript` for a conversational interface with timeline and draft pane
2. Read the [Technical Reference](technical.md) for full API and domain model details
3. Configure different styles for Threads vs LinkedIn and compare the draft output
4. Try managing writing samples — create, update, and delete to refine your voice

---

## Exercises

Test your understanding:

1. **Easy:** Create a buffer with 3 thoughts, then list your buffers to verify the title was auto-derived from the first thought
2. **Medium:** Configure style instructions for two different categories (e.g., linkedin and threads), then generate a draft for each from the same buffer and compare the output
3. **Hard:** Build a complete writing workflow — create a buffer, add 5 thoughts, configure style instructions and 2 writing samples for a category, generate a draft, add another thought, generate a second draft, then retrieve the workspace and compare both versions

<details>
<summary>Solutions</summary>

### Exercise 1: Three Thoughts and List

```bash
# First thought creates the buffer
RESPONSE=$(curl -s -X POST .../impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"utterance": "Remote work increases productivity for deep tasks"}')

BUFFER_ID=$(echo $RESPONSE | jq -r '.data.bufferId')

# Second and third thoughts
curl -s -X POST .../impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"But collaboration suffers without intentional rituals\"}"

curl -s -X POST .../impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"The hybrid model is the pragmatic middle ground\"}"

# Verify — title should be "Remote work increases productivity for deep tasks"
curl -s .../buffers -H "Authorization: Bearer $TOKEN" | jq '.data[0].title'
```

### Exercise 2: Cross-Category Drafts

```bash
# Set LinkedIn style
curl -s -X PUT .../writing-config/linkedin/style \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Professional, detailed, 1000+ words with section headers"}'

# Set Threads style
curl -s -X PUT .../writing-config/threads/style \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Punchy, opinionated, under 500 characters, no headers"}'

# Generate LinkedIn draft
curl -s -X POST .../impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"Write the draft\", \"category\": \"linkedin\"}"

# Generate Threads draft
curl -s -X POST .../impose \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bufferId\": \"$BUFFER_ID\", \"utterance\": \"Write the draft\", \"category\": \"threads\"}"

# Compare in workspace
curl -s .../buffers/$BUFFER_ID -H "Authorization: Bearer $TOKEN" | jq '.data.draftVersions'
```

### Exercise 3: Complete Workflow

Build up incrementally: create buffer with 5 impose calls, configure style via PUT to `/writing-config/:category/style`, add 2 samples via POST to `/writing-config/:category/samples`, generate draft twice with the same category, then retrieve the workspace and compare `draftVersions[0].markdown` with `draftVersions[1].markdown`.

</details>
