# Research Agent - Tutorial

This tutorial will help you get started with the research-agent service, from creating your first research to sharing results.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests
- At least one LLM provider API key configured (Claude, OpenAI, Google, or Perplexity)

## Part 1: Hello World - Create Research

The simplest interaction is creating a new research query.

### Step 1: Get your access token

Authenticate with Auth0:

```bash
curl -X POST https://YOUR_DOMAIN/auth/oauth/device/code \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "YOUR_CLIENT_ID",
    "scope": "openid profile email offline_access",
    "audience": "urn:intexuraos:api"
  }'
```

Follow the verification URL, then poll for the token:

```bash
curl -X POST https://YOUR_DOMAIN/auth/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": "YOUR_DEVICE_CODE",
    "client_id": "YOUR_CLIENT_ID"
  }'
```

### Step 2: Create research

```bash
curl -X POST https://research-agent.intexuraos.com/research \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What are the latest developments in quantum computing?",
    "selectedModels": ["gemini-2.5-flash", "gpt-4o-mini"],
    "synthesisModel": "gemini-2.5-flash",
    "skipSynthesis": false
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "research_abc123",
    "userId": "user_xyz",
    "title": "",
    "prompt": "What are the latest developments in quantum computing?",
    "selectedModels": ["gemini-2.5-flash", "gpt-4o-mini"],
    "synthesisModel": "gemini-2.5-flash",
    "status": "processing",
    "llmResults": [
      {
        "provider": "google",
        "model": "gemini-2.5-flash",
        "status": "pending"
      },
      {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "status": "pending"
      }
    ],
    "startedAt": "2026-01-13T10:00:00Z"
  }
}
```

### Step 3: Poll for completion

```bash
curl -X GET https://research-agent.intexuraos.com/research/research_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

When `status` is `completed`, you'll have:

```json
{
  "success": true,
  "data": {
    "id": "research_abc123",
    "title": "Quantum Computing Advances in 2024",
    "status": "completed",
    "synthesizedResult": "# Quantum Computing Advances\n\n## Key Developments\n\n...",
    "shareInfo": {
      "shareUrl": "https://intexuraos.com/r/quantum-advances-abc",
      "sharedAt": "2026-01-13T10:05:00Z"
    },
    "totalCostUsd": 0.0042,
    "totalDurationMs": 15000
  }
}
```

### Checkpoint

You should have:
1. Created a research that queried multiple models
2. Received a synthesized result combining all responses
3. Gotten a shareable URL with an AI-generated cover image

## Part 2: Add Context to Research

Enhance your research by providing additional context.

### Add input contexts

```bash
curl -X POST https://research-agent.intexuraos.com/research \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize the key points about climate change",
    "selectedModels": ["gemini-2.5-flash"],
    "synthesisModel": "gemini-2.5-flash",
    "inputContexts": [
      {
        "content": "Climate change is causing global temperatures to rise...",
        "label": "Wikipedia Article"
      },
      {
        "content": "The IPCC report states that we need to reduce emissions...",
        "label": "IPCC Report"
      }
    ]
  }'
```

The synthesis will include and attribute the provided context alongside LLM-generated content.

### Step 3: Enhance existing research

Add more models or context to a completed research:

```bash
curl -X POST https://research-agent.intexuraos.com/research/research_abc123/enhance \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "additionalModels": ["claude-3-5-sonnet-20241022"],
    "additionalContexts": [
      {
        "content": "New information about quantum error correction...",
        "label": "Recent Paper"
      }
    ]
  }'
```

This creates a new research that:
- Preserves completed LLM results from the original
- Adds new models to query
- Adds new context to the synthesis
- Tracks the original as `sourceResearchId`

## Part 3: Handle Errors

### Error: API key missing

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "No google API key configured for this user"
  }
}
```

**Cause:** You haven't configured an API key for the requested provider.

**Solution:** Add your API key via the user-service settings endpoint.

### Error: Partial failure

```json
{
  "success": true,
  "data": {
    "status": "awaiting_confirmation",
    "partialFailure": {
      "failedModels": ["gpt-4o"],
      "detectedAt": "2026-01-13T10:03:00Z",
      "retryCount": 0
    }
  }
}
```

**Cause:** Some LLMs failed but others succeeded.

**Solution:** Choose to:
1. **Proceed** - Use completed results only
2. **Retry** - Retry failed models
3. **Cancel** - Mark research as failed

```bash
# Proceed with completed results
curl -X POST https://research-agent.intexuraos.com/research/research_abc123/retry-failed \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision": "proceed"}'

# Retry failed models
curl -X POST https://research-agent.intexuraos.com/research/research_abc123/retry-failed \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision": "retry"}'
```

### Error: Research not found

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Research not found"
  }
}
```

**Cause:** The research ID doesn't exist or belongs to another user.

**Solution:** Verify the ID and that you're authenticated as the owner.

## Part 4: Real-World Scenario - Multi-Model Research with Sharing

Create comprehensive research and share it publicly.

### Step 1: Create research with multiple models

```bash
curl -X POST https://research-agent.intexuraos.com/research \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What are the pros and cons of TypeScript vs JavaScript for large applications?",
    "selectedModels": [
      "claude-3-5-sonnet-20241022",
      "gpt-4o",
      "gemini-2.5-pro"
    ],
    "synthesisModel": "gemini-2.5-pro"
  }'
```

### Step 2: Wait for completion and view results

```bash
curl -X GET https://research-agent.intexuraos.com/research/RESEARCH_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3: Access the shared URL

The response includes `shareInfo.shareUrl`. Access it without authentication:

```bash
curl https://research-agent.intexuraos.com/research/shared/typescript-vs-js
```

### Step 4: Unshare (delete public access)

```bash
curl -X POST https://research-agent.intexuraos.com/research/RESEARCH_ID/unshare \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

This removes the public page and deletes the generated cover image.

## Troubleshooting

| Issue                        | Symptom                           | Solution                                                                       |
| ----------------------------  | ---------------------------------  | ------------------------------------------------------------------------------  |
| Research stuck in processing | Status never changes to completed | Check Pub/Sub configuration; verify LLM call queue is being processed          |
| Synthesis fails              | Research shows `synthesisError`   | Check synthesis model API key; verify context doesn't exceed limits            |
| High costs                   | Unexpected `totalCostUsd`         | Review model selection; use smaller models (flash/mini) for initial queries    |
| Missing attribution          | Some sections lack source links   | Attribution repair runs automatically; if it fails, content is still available |
| Share URL 404s               | Public URL doesn't work           | Verify `shareInfo` exists; check GCS bucket configuration                      |

## Exercises

### Easy

1. Create a research using only one model
2. List all your researches ordered by completion date
3. Find the total cost of all your researches

### Medium

1. Create research with input contexts and verify attribution
2. Enhance a completed research with additional models
3. Share a research and verify the public page renders correctly

### Hard

1. Implement a client that polls for research completion
2. Create a script that compares results from different models
3. Build a cost estimator before research submission
