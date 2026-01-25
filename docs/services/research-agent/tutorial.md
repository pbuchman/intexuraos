# Research Agent - Tutorial

This tutorial will help you get started with the research-agent service, from creating your first research to using advanced features like natural language model selection and context enhancement.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests
- At least one LLM provider API key configured (Claude, OpenAI, Google, Perplexity, or Zai)

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
    "selectedModels": ["gemini-2.5-flash", "gpt-5.2"],
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
    "selectedModels": ["gemini-2.5-flash", "gpt-5.2"],
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
        "model": "gpt-5.2",
        "status": "pending"
      }
    ],
    "startedAt": "2026-01-25T10:00:00Z"
  }
}
```

### Step 3: Poll for completion

```bash
curl -X GET https://research-agent.intexuraos.com/research/research_abc123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

When `status` is `completed`, you will have:

```json
{
  "success": true,
  "data": {
    "id": "research_abc123",
    "title": "Quantum Computing Advances in 2026",
    "status": "completed",
    "synthesizedResult": "# Quantum Computing Advances\n\n## Key Developments\n\n...",
    "shareInfo": {
      "shareUrl": "https://intexuraos.com/r/quantum-advances-abc",
      "sharedAt": "2026-01-25T10:05:00Z"
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

## Part 2: Natural Language Model Selection (v2.0.0)

The new model extraction feature lets you specify models in natural language.

### Create draft with natural language

When creating research through actions-agent, specify models conversationally:

```bash
curl -X POST https://actions-agent.intexuraos.com/actions \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Use Claude and Gemini to research the impact of AI on healthcare"
  }'
```

The `extractModelPreferences` use case will:

1. Parse your message for model keywords
2. Check which API keys you have configured
3. Select appropriate models (one per provider)
4. Create a draft with pre-selected models

**Expected draft response:**

```json
{
  "success": true,
  "data": {
    "id": "research_draft_xyz",
    "status": "draft",
    "selectedModels": ["claude-opus-4.5", "gemini-2.5-pro"],
    "synthesisModel": "gemini-2.5-pro"
  }
}
```

### Model keywords recognized

| Keyword               | Model Selected         |
| --------------------- | ---------------------- |
| "claude", "anthropic" | `claude-opus-4.5`      |
| "gpt", "openai"       | `gpt-5.2`              |
| "gemini", "google"    | `gemini-2.5-pro`       |
| "perplexity", "sonar" | `sonar-pro`            |
| "glm", "zai"          | `glm-4.7`              |
| "deep research"       | deep research variants |
| "fast", "flash"       | flash/mini variants    |

### Filtering by API keys

If you mention a model but do not have the API key, it is silently excluded:

```bash
# User has Google and OpenAI keys, but NOT Anthropic
"Use Claude, Gemini, and GPT to research X"
# Result: selectedModels = ["gemini-2.5-pro", "gpt-5.2"]
# (Claude excluded because no anthropic API key)
```

## Part 3: Add Context to Research

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

### Enhance existing research

Add more models or context to a completed research:

```bash
curl -X POST https://research-agent.intexuraos.com/research/research_abc123/enhance \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "additionalModels": ["claude-opus-4.5"],
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

## Part 4: Understanding Zod Schema Validation (v2.0.0)

The research-agent uses Zod schemas to validate LLM responses.

### ResearchContext inference

When synthesis begins, the service infers context from your query:

```json
{
  "language": "en",
  "domain": "technical",
  "mode": "standard",
  "intent_summary": "Understanding quantum computing developments",
  "answer_style": ["evidence_first", "practical"],
  "time_scope": {
    "as_of_date": "2026-01-25",
    "prefers_recent_years": 2,
    "is_time_sensitive": true
  },
  "research_plan": {
    "key_questions": ["What breakthroughs occurred?", "What challenges remain?"],
    "preferred_source_types": ["academic", "official"]
  }
}
```

### Parser + repair pattern

If the LLM returns malformed JSON, the service attempts repair:

1. First attempt: Parse and validate with Zod
2. If validation fails: Send repair prompt with specific errors
3. Repair attempt: Parse the corrected response
4. If repair fails: Return combined error for debugging

You can see this in the response's `researchContext` field when present.

## Part 5: Handle Errors

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

**Cause:** You have not configured an API key for the requested provider.

**Solution:** Add your API key via the user-service settings endpoint.

### Error: Missing models for selected providers

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Missing API keys for selected models",
    "details": {
      "missingModels": ["claude-opus-4.5"]
    }
  }
}
```

**Cause:** You selected models but do not have the required API keys.

**Solution:** Either configure the missing API key or remove the model from selection.

### Error: Partial failure

```json
{
  "success": true,
  "data": {
    "status": "awaiting_confirmation",
    "partialFailure": {
      "failedModels": ["gpt-5.2"],
      "detectedAt": "2026-01-25T10:03:00Z",
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
curl -X POST https://research-agent.intexuraos.com/research/research_abc123/confirm \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision": "proceed"}'

# Retry failed models
curl -X POST https://research-agent.intexuraos.com/research/research_abc123/confirm \
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

**Cause:** The research ID does not exist or belongs to another user.

**Solution:** Verify the ID and that you are authenticated as the owner.

## Part 6: Real-World Scenario - Multi-Model Research with Sharing

Create comprehensive research and share it publicly.

### Step 1: Create research with multiple models

```bash
curl -X POST https://research-agent.intexuraos.com/research \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What are the pros and cons of TypeScript vs JavaScript for large applications?",
    "selectedModels": [
      "claude-opus-4.5",
      "gpt-5.2",
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
curl -X DELETE https://research-agent.intexuraos.com/research/RESEARCH_ID/share \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

This removes the public page and deletes the generated cover image.

## Troubleshooting

| Issue                        | Symptom                           | Solution                                                                       |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Research stuck in processing | Status never changes to completed | Check Pub/Sub configuration; verify LLM call queue is being processed          |
| Synthesis fails              | Research shows `synthesisError`   | Check synthesis model API key; verify context does not exceed limits           |
| High costs                   | Unexpected `totalCostUsd`         | Review model selection; use smaller models (flash/mini) for initial queries    |
| Missing attribution          | Some sections lack source links   | Attribution repair runs automatically; if it fails, content is still available |
| Share URL 404s               | Public URL does not work          | Verify `shareInfo` exists; check GCS bucket configuration                      |
| Model extraction fails       | Draft has empty selectedModels    | Check if you have API keys; extraction gracefully degrades to manual selection |
| Zod validation errors        | Research fails with schema error  | Check logs for specific field errors; repair pattern may have failed           |

## Exercises

### Easy

1. Create a research using only one model
2. List all your researches ordered by completion date
3. Find the total cost of all your researches

### Medium

1. Create research with input contexts and verify attribution
2. Use natural language to select models ("use Claude and Gemini")
3. Enhance a completed research with additional models

### Hard

1. Implement a client that polls for research completion
2. Create a script that compares results from different models
3. Build a cost estimator before research submission
4. Parse the `researchContext` to understand how the service interpreted your query
