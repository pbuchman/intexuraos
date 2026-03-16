# Research Agent — Tutorial

> **Time:** 20–30 minutes
> **Prerequisites:** Node.js 20+, valid Auth0 access token, at least one LLM provider API key configured in user-service
> **You'll learn:** How to submit research, poll for completion, understand partial failures, and enhance existing results

---

## What You'll Build

A working integration that:

- Submits a multi-model research prompt and receives a synthesized report
- Polls research status and handles the full lifecycle
- Handles partial failures with user confirmation
- Enhances a completed research with additional context

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS project
- [ ] A valid Auth0 bearer token (obtain via the web app login flow)
- [ ] At least one LLM API key configured (Google, OpenAI, or Anthropic)
- [ ] `curl` and `jq` installed for the examples

Set your token and base URL:

```bash
export TOKEN="your-auth0-bearer-token"
export BASE_URL="https://your-research-agent-url"
```

---

## Part 1: Submit Your First Research (5 minutes)

### Step 1.1: Submit a Research Request

```bash
curl -s -X POST "$BASE_URL/research" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What are the main tradeoffs between PostgreSQL and MongoDB for a SaaS product?",
    "selectedModels": ["gemini-2.5-pro", "claude-sonnet-4-5"],
    "synthesisModel": "gemini-2.5-pro"
  }' | jq .
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "res_abc123",
    "status": "pending",
    "title": "",
    "prompt": "What are the main tradeoffs...",
    "selectedModels": ["gemini-2.5-pro", "claude-sonnet-4-5"],
    "synthesisModel": "gemini-2.5-pro",
    "llmResults": [
      { "model": "gemini-2.5-pro", "status": "pending" },
      { "model": "claude-sonnet-4-5", "status": "pending" }
    ],
    "startedAt": "2026-03-15T10:00:00.000Z"
  }
}
```

Save the research ID:

```bash
export RESEARCH_ID="res_abc123"
```

### What Just Happened?

Research Agent saved the research to Firestore with status `pending` and published a `research.process` event to Pub/Sub. The processing runs asynchronously — the response comes back immediately without waiting for LLM calls.

---

## Part 2: Poll for Completion (10 minutes)

Research processing is asynchronous. Poll the status endpoint until the research reaches `completed` or `failed`.

### Step 2.1: Check Research Status

```bash
curl -s "$BASE_URL/research/$RESEARCH_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.status'
```

The status progresses through this lifecycle:

```
pending → processing → synthesizing → completed
                     ↘ awaiting_confirmation (partial failure)
                     ↘ failed (all models failed)
```

### Step 2.2: Simple Poll Loop

```bash
while true; do
  STATUS=$(curl -s "$BASE_URL/research/$RESEARCH_ID" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  sleep 5
done
```

### Step 2.3: Read the Completed Result

```bash
curl -s "$BASE_URL/research/$RESEARCH_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{
      title: .data.title,
      status: .data.status,
      totalCostUsd: .data.totalCostUsd,
      synthesizedResult: (.data.synthesizedResult | .[0:500]),
      shareUrl: .data.shareInfo.shareUrl
    }'
```

**Checkpoint:** You should see the synthesized markdown report, a title generated from your prompt, cost in USD, and a public share URL.

---

## Part 3: Handle Partial Failures (5 minutes)

Sometimes one or more models fail while others succeed. Research Agent holds processing in `awaiting_confirmation` status and requires the user to decide what to do.

### Step 3.1: Detect a Partial Failure

When polling, check for `awaiting_confirmation`:

```bash
curl -s "$BASE_URL/research/$RESEARCH_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{
      status: .data.status,
      partialFailure: .data.partialFailure
    }'
```

**Response when partial failure occurs:**

```json
{
  "status": "awaiting_confirmation",
  "partialFailure": {
    "failedModels": ["claude-sonnet-4-5"],
    "detectedAt": "2026-03-15T10:05:00.000Z",
    "retryCount": 0
  }
}
```

### Step 3.2: Confirm the Decision

Send a confirmation with one of three decisions:

| Decision  | Meaning                                          |
| --------- | ------------------------------------------------ |
| `proceed` | Synthesize using only the successful models      |
| `retry`   | Re-run the failed models before synthesizing     |
| `cancel`  | Mark the research as failed                      |

```bash
curl -s -X POST "$BASE_URL/research/$RESEARCH_ID/confirm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "decision": "proceed" }' | jq .
```

After `proceed`, the research moves to `synthesizing` and completes normally using the successful models only.

---

## Part 4: Enhance an Existing Research (10 minutes)

Enhancement lets you expand a completed research without re-running models that already succeeded.

### Step 4.1: Add a New Model and Context

```bash
curl -s -X POST "$BASE_URL/research/$RESEARCH_ID/enhance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "additionalModels": ["sonar-pro"],
    "additionalContexts": [
      {
        "content": "Our current stack: Node.js backend, 50k users, 10TB data, heavy write workload.",
        "label": "Current Architecture"
      }
    ]
  }' | jq '.data.id'
```

**Expected response:** A new research ID. The enhanced research:

- Copies completed LLM results from the source (marked `copiedFromSource: true`)
- Runs only `sonar-pro` against the original prompt plus the new context
- Re-synthesizes with all results combined
- Tracks source costs separately in `sourceLlmCostUsd`

### Step 4.2: Poll and Read the Enhanced Result

Use the new research ID from Step 4.1:

```bash
export ENHANCED_ID="res_enhanced456"

# Poll until complete
while true; do
  STATUS=$(curl -s "$BASE_URL/research/$ENHANCED_ID" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data.status')
  echo "Status: $STATUS"
  [ "$STATUS" = "completed" ] && break
  sleep 5
done

# Read result
curl -s "$BASE_URL/research/$ENHANCED_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{
      title: .data.title,
      sourceResearchId: .data.sourceResearchId,
      totalCostUsd: .data.totalCostUsd,
      sourceLlmCostUsd: .data.sourceLlmCostUsd
    }'
```

**Result:** `sourceLlmCostUsd` shows how much was reused from the original; `totalCostUsd` includes both old and new costs.

---

## Troubleshooting

| Problem                          | Solution                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `401 Unauthorized`               | Your bearer token is expired — refresh it via the web app login flow                                               |
| `404 Not Found`                  | The research ID does not exist or belongs to a different user                                                      |
| Status stuck at `processing`     | Check Pub/Sub subscription delivery — the LLM call topic may be backlogged                                         |
| Status `failed`, all models down | At least one API key is missing or invalid — check user-service keys                                               |
| `enhance` returns `NO_CHANGES`   | You must provide at least one of: additionalModels, additionalContexts, synthesisModel change, or removeContextIds |
| Notion export not appearing      | Confirm `POST /research/settings/notion` was called with a valid page ID                                           |

---

## Next Steps

Now that you understand the basics:

1. Configure Notion export via `POST /research/settings/notion` to get automatic research archiving
2. Explore the draft workflow — use `POST /research/draft` to create a review-before-run flow
3. Read the [Technical Reference](technical.md) for full API schemas and the complete status lifecycle
4. See how [actions-agent](../actions-agent/technical.md) triggers draft research from natural language commands

---

## Exercises

Test your understanding:

1. **Easy:** List all your researches and find the one with the highest `totalCostUsd`
2. **Medium:** Submit a research with `skipSynthesis: true` — observe what status it reaches and why the result differs from a normal research
3. **Hard:** Submit a research, wait for `awaiting_confirmation` (you can simulate by providing an invalid API key for one model), then test all three confirmation decisions — `proceed`, `retry`, and `cancel` — and observe the resulting status transitions

<details>
<summary>Solutions</summary>

### Exercise 1: Highest-Cost Research

```bash
curl -s "$BASE_URL/research" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.data[]] | sort_by(.totalCostUsd // 0) | reverse | first | {id, title, totalCostUsd}'
```

### Exercise 2: Skip Synthesis

```bash
curl -s -X POST "$BASE_URL/research" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is dependency injection?",
    "selectedModels": ["gemini-2.5-pro"],
    "synthesisModel": "gemini-2.5-pro",
    "skipSynthesis": true
  }' | jq .
```

With `skipSynthesis: true`, the research reaches `completed` after the single model call, with no `synthesizedResult`. The single LLM result is directly accessible in `llmResults[0].result`.

### Exercise 3: Partial Failure Decisions

Configure one model with no API key by temporarily removing it from user-service. Submit a two-model research. When `awaiting_confirmation` appears, test:

- `"decision": "proceed"` → synthesizes with the successful model
- `"decision": "retry"` → re-queues the failed model; status goes to `retrying`
- `"decision": "cancel"` → status transitions to `failed`

</details>
