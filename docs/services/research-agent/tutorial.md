# Research Agent - Tutorial

This tutorial will help you get started with the research-agent service, from creating your first research to using advanced features like natural language model selection and context enhancement.

## Prerequisites

- IntexuraOS development environment running
- Auth0 access token for API requests
- At least one LLM provider API key configured (Claude, OpenAI, Google, Perplexity, or Zai)

**Note:** If `INTEXURAOS_GEMINI_APP_API_KEY` or `INTEXURAOS_ZAI_APP_API_KEY` are configured on the server, users without their own API keys automatically get `gemini-2.0-flash` or `glm-4.7-flash` as fallback models.

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

## Part 2: Validate and Improve Your Prompt

Before creating research, check whether your prompt is clear enough for good results.

### Validate input quality

```bash
curl -X POST https://research-agent.intexuraos.com/research/validate-input \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Is AI good?",
    "includeImprovement": true
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "quality": 1,
    "reason": "The prompt is too vague - it does not specify which aspect of AI to evaluate or what criteria to use.",
    "improvedPrompt": "What are the measurable impacts of generative AI adoption on enterprise productivity, based on peer-reviewed studies from 2023-2026?"
  }
}
```

Quality values: `0` = rejected (too low quality), `1` = weak but valid (improvement suggested), `2` = good (ready to use).

The improvement system preserves your original language. A Polish prompt returns a Polish improvement. If the LLM returns a malformed improvement (unwanted prefixes, JSON markers, or explanatory text), the system detects this and retries automatically.

### Force-improve a prompt

```bash
curl -X POST https://research-agent.intexuraos.com/research/improve-input \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Tell me about climate change"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "improvedPrompt": "What are the current scientific consensus and key areas of debate regarding climate change impacts on global food security, water resources, and biodiversity loss over the next 30 years?"
  }
}
```

## Part 3: Natural Language Model Selection

The model extraction feature lets you specify models in natural language.

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

## Part 4: Add Context to Research

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

## Part 5: Understanding Zod Schema Validation

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

**Note (v3.1.0):** The `ContextInferenceAdapter` was simplified during the monorepo-wide prompt audit, replacing unsafe casts with safer fallback defaults.

## Part 6: Handle Errors

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

## Part 7: Real-World Scenario - Multi-Model Research with Sharing

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

## Part 8: Export Research to Notion

Research can be exported to Notion as structured pages. This requires Notion integration to be configured.

### Step 1: Configure Notion export settings

First, validate a Notion page ID where research will be exported:

```bash
curl -X POST https://research-agent.intexuraos.com/research/settings/notion/validate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "researchPageId": "YOUR_NOTION_PAGE_ID"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "title": "My Research Collection",
    "url": "https://www.notion.so/my-research-collection-abc123"
  }
}
```

Then save the settings:

```bash
curl -X POST https://research-agent.intexuraos.com/research/settings/notion \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "researchPageId": "YOUR_NOTION_PAGE_ID",
    "researchPageTitle": "My Research Collection",
    "researchPageUrl": "https://www.notion.so/my-research-collection-abc123"
  }'
```

### Step 2: Automatic export

Once configured, completed research is automatically exported to Notion after synthesis. The export is fire-and-forget and does not block the synthesis flow.

Check the `notionExportInfo` field in the research response:

```json
{
  "success": true,
  "data": {
    "id": "research_abc123",
    "status": "completed",
    "notionExportInfo": {
      "mainPageId": "notion-page-id-abc",
      "mainPageUrl": "https://notion.so/research-title-abc",
      "llmReportPageIds": [
        { "model": "gemini-2.5-flash", "pageId": "report-page-1" },
        { "model": "gpt-5.2", "pageId": "report-page-2" }
      ],
      "exportedAt": "2026-02-08T10:05:00Z"
    }
  }
}
```

### Step 3: Manual export

If automatic export was skipped (Notion not configured at the time), export manually:

```bash
curl -X POST https://research-agent.intexuraos.com/research/RESEARCH_ID/export-notion \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Prerequisites:**

- Research must be in `completed` status
- Research must have a synthesis result
- Research must not have been already exported
- Notion must be connected and page configured

### Notion page structure

The export creates:

- **Main Research Page** (child of your configured target page)
  - Cover image (if available)
  - "Synthesis" section with full formatted content
  - "Sources" section
- **LLM Report Pages** (children of the main page, one per model)
  - "Response" section with the model's full response
  - "Sources" section with linked URLs

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
| Notion export missing        | `notionExportInfo` is undefined   | Check Notion is connected and page ID is configured in settings                |
| Notion export fails          | Error on export-notion endpoint   | Verify Notion token is valid; check NOTION_NOT_CONNECTED or RATE_LIMITED error |
| Already exported             | `ALREADY_EXPORTED` error          | Each research can only be exported once; delete the Notion page manually       |
| Invalid page ID              | Validation fails                  | Page ID must be 32 hex characters or UUID format                               |
| Malformed improvement        | Improvement has unwanted format   | Structural checks detect and reject; system retries automatically              |

## Exercises

### Easy

1. Create a research using only one model
2. List all your researches ordered by completion date
3. Find the total cost of all your researches
4. Validate input quality for a vague prompt and view the suggested improvement

### Medium

1. Create research with input contexts and verify attribution
2. Use natural language to select models ("use Claude and Gemini")
3. Enhance a completed research with additional models
4. Configure Notion export settings and export a completed research

### Hard

1. Implement a client that polls for research completion
2. Create a script that compares results from different models
3. Build a cost estimator before research submission
4. Parse the `researchContext` to understand how the service interpreted your query
5. Verify automatic Notion export by checking `notionExportInfo` after synthesis completes
