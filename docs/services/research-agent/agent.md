# research-agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| Name      | research-agent                                                                      |
| Role      | Orchestrate parallel LLM research calls and synthesize results into a single report |
| Goal      | Produce a cross-validated, attributed research document from multiple AI providers  |

## Capabilities

### Submit Research

**Endpoint:** `POST /`

**Auth:** Bearer JWT

**When to use:** When you need a research question answered by multiple LLM providers and synthesized into one document.

**Input Schema:**

```typescript
interface SubmitResearchInput {
  prompt: string;                  // Research question (min 1 char)
  selectedModels: ResearchModel[]; // Models to use for research (native or or:-prefixed OpenRouter)
  synthesisModel: ResearchModel;   // Model to use for synthesis
  inputContexts?: {
    content: string;               // Max 60,000 chars per context
    label?: string;
  }[];                             // Max 5 contexts
  skipSynthesis?: boolean;         // Skip synthesis step (single-model raw output)
  originalPrompt?: string;         // Original prompt before improvement
}
```

**Output Schema:**

```typescript
interface SubmitResearchOutput {
  id: string;
  status: 'pending';
  title: string;            // Empty string initially, populated after processing
  prompt: string;
  selectedModels: string[];
  synthesisModel: string;
  llmResults: LlmResult[];
  startedAt: string;        // ISO 8601
}
```

**Example:**

```json
// Request
{
  "prompt": "Compare PostgreSQL vs MongoDB for a SaaS product",
  "selectedModels": ["gemini-2.5-pro", "claude-sonnet-4-6", "or:x-ai/grok-4.20-beta"],
  "synthesisModel": "gemini-2.5-pro"
}

// Response
{
  "success": true,
  "data": {
    "id": "res_abc123",
    "status": "pending",
    "title": "",
    "selectedModels": ["gemini-2.5-pro", "claude-sonnet-4-6", "or:x-ai/grok-4.20-beta"],
    "llmResults": [
      { "model": "gemini-2.5-pro", "status": "pending" },
      { "model": "claude-sonnet-4-6", "status": "pending" },
      { "model": "or:x-ai/grok-4.20-beta", "status": "pending" }
    ],
    "startedAt": "2026-03-15T10:00:00.000Z"
  }
}
```

---

### Get Research

**Endpoint:** `GET /:id`

**Auth:** Bearer JWT

**When to use:** Poll for status and retrieve completed research results.

**Output Schema:**

```typescript
interface GetResearchOutput {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  status: ResearchStatus;
  llmResults: LlmResult[];
  synthesizedResult?: string;         // Markdown, present when completed
  synthesisError?: string;
  partialFailure?: PartialFailure;
  shareInfo?: ShareInfo;
  notionExportInfo?: NotionExportInfo;
  attributionStatus?: 'complete' | 'incomplete' | 'repaired';
  totalCostUsd?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  sourceResearchId?: string;
  favourite: boolean;
  startedAt: string;
  completedAt?: string;
}

type ResearchStatus =
  | 'draft'
  | 'pending'
  | 'processing'
  | 'awaiting_confirmation'
  | 'retrying'
  | 'synthesizing'
  | 'completed'
  | 'failed';

interface LlmResult {
  provider: string;       // google, openai, anthropic, perplexity, openrouter
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  sources?: string[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  copiedFromSource?: boolean;
  qualityFlag?: 'normal' | 'low_quality';
}
```

---

### List Researches

**Endpoint:** `GET /`

**Auth:** Bearer JWT

**When to use:** Retrieve a paginated list of the user's researches as lightweight summaries.

**Query Parameters:**

```typescript
interface ListResearchesQuery {
  limit?: number;   // Page size
  cursor?: string;  // Pagination cursor from previous response
}
```

**Output Schema:**

```typescript
interface ListResearchesOutput {
  items: ResearchSummary[];
  nextCursor?: string;
}

interface ResearchSummary {
  id: string;
  userId: string;
  title: string;
  status: ResearchStatus;
  selectedModels: string[];
  synthesisModel: string;
  startedAt: string;
  completedAt?: string;
  favourite?: boolean;
  llmResultStatuses: { provider: string; model: string; status: string }[];
  totalCostUsd?: number;
  partialFailure?: PartialFailure;
}
```

---

### Validate Input

**Endpoint:** `POST /validate-input`

**Auth:** Bearer JWT

**When to use:** Before submitting a research, to check prompt quality and optionally get an improved version.

**Input Schema:**

```typescript
interface ValidateInputBody {
  prompt: string;
  includeImprovement?: boolean;  // If true and quality is weak, returns improved prompt
}
```

**Output Schema:**

```typescript
interface ValidateInputOutput {
  quality: number;               // 0 = invalid, 1 = weak but valid, 2 = good
  reason: string;
  improvedPrompt: string | null; // Present when includeImprovement=true and quality=1
}
```

---

### Confirm Partial Failure

**Endpoint:** `POST /:id/confirm`

**Auth:** Bearer JWT

**When to use:** When research status is `awaiting_confirmation` — one or more models failed while others succeeded.

**Input Schema:**

```typescript
interface ConfirmPartialFailureInput {
  decision: 'proceed' | 'retry' | 'cancel';
}
```

| Decision  | Effect                                                   |
| --------- | -------------------------------------------------------- |
| `proceed` | Synthesize using successful results only                 |
| `retry`   | Re-queue failed models; status -> `retrying`             |
| `cancel`  | Mark research as `failed`                                |

---

### Enhance Research

**Endpoint:** `POST /:id/enhance`

**Auth:** Bearer JWT

**When to use:** When a research is `completed` and you want to add new models or context without re-running existing successful calls.

**Input Schema:**

```typescript
interface EnhanceResearchInput {
  additionalModels?: ResearchModel[];
  additionalContexts?: {
    content: string;
    label?: string;
  }[];
  synthesisModel?: ResearchModel;     // Override synthesis model
  removeContextIds?: string[];        // Context IDs to drop from source
}
```

**Constraints:** At least one of `additionalModels`, `additionalContexts`, `synthesisModel`, or `removeContextIds` must be provided.

**Output:** New research object with `sourceResearchId` pointing to the original.

---

### Browse OpenRouter Models

**Endpoint:** `GET /openrouter/models`

**Auth:** Bearer JWT

**When to use:** To discover available OpenRouter models and their live pricing before submitting research.

**Output Schema:**

```typescript
interface OpenRouterModelsOutput {
  models: OpenRouterModelInfo[];
  cachedAt: string;                // ISO 8601, cache TTL is 5 minutes
}

interface OpenRouterModelInfo {
  id: string;                      // e.g., "qwen/qwen3.5-plus-02-15"
  name: string;                    // e.g., "Qwen 3.5 Plus"
  provider: string;                // e.g., "Qwen"
  contextLength: number;
  pricing: {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    useProviderCost?: boolean;     // true when live pricing used
  };
  inputModalities: string[];
  outputModalities: string[];
}
```

**Note:** OpenRouter models are prefixed with `or:` when used in `selectedModels` (e.g., `or:qwen/qwen3.5-plus-02-15`). The endpoint returns raw model IDs without the prefix.

---

### Create Draft Research (Internal)

**Endpoint:** `POST /internal/research/draft`

**Auth:** `X-Internal-Auth` header

**When to use:** When another service, such as Intex, wants to create a research draft for review before LLM calls are made.

**Input Schema:**

```typescript
interface CreateDraftResearchBody {
  userId: string;
  title: string;
  prompt: string;           // min 10, max 20000 chars
  originalMessage: string;  // Original user message for model preference extraction
  sourceActionId?: string;
}
```

**Output:**

```typescript
interface ServiceFeedback {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string;   // e.g., "/#/research/{id}"
  errorCode?: string;
}
```

---

## Constraints

**Do NOT:**

- Call `/internal/*` endpoints without a valid `X-Internal-Auth` token or Pub/Sub OIDC header
- Attempt to enhance a research that is not in `completed` status
- Submit more than 5 input contexts or any context exceeding 60,000 characters
- Expect `synthesizedResult` to be populated until `status === 'completed'`
- Retry a research that is not in `failed` status
- Use OpenRouter model IDs without the `or:` prefix in `selectedModels`

**Requires:**

- User must have LLM API keys configured in user-service for the selected models
- OpenRouter models require an OpenRouter API key configured in user-service
- Synthesis model API key must be present — missing key causes immediate `failed` status
- Notion export requires `POST /settings/notion` to be configured first

## Usage Patterns

### Pattern 1: Submit and Poll to Completion

```
1. POST / -> receive researchId
2. GET /:id every 5 seconds
3. If status === 'awaiting_confirmation':
   a. Read partialFailure.failedModels
   b. POST /:id/confirm with { decision: 'proceed' | 'retry' | 'cancel' }
4. Wait for status === 'completed' or 'failed'
5. Read synthesizedResult and shareInfo.shareUrl
```

### Pattern 2: Validate Then Submit

```
1. POST /validate-input with { prompt, includeImprovement: true }
2. If quality === 0: reject, prompt is invalid
3. If quality === 1 and improvedPrompt is present: offer improved version to user
4. POST / with final prompt
```

### Pattern 3: Internal Draft Creation (from another service)

```
1. POST /internal/research/draft with userId, title, prompt, originalMessage
2. Response includes resourceUrl = "/#/research/{id}"
3. User visits dashboard, reviews draft, clicks approve
4. Research moves to pending -> processing -> completed
```

### Pattern 4: Incremental Enhancement

```
1. Ensure source research status === 'completed'
2. POST /:sourceId/enhance with additionalModels and/or additionalContexts
3. Poll new research ID to completion
4. Compare totalCostUsd vs sourceLlmCostUsd to see incremental spend
```

### Pattern 5: OpenRouter Model Discovery

```
1. GET /openrouter/models -> list of 15 curated models with pricing
2. Select models by id, prefix with 'or:' for selectedModels array
3. POST / with or:-prefixed model IDs alongside native models
```

## Error Handling

| HTTP Status | Meaning                                                       | Recovery                                  |
| ----------- | ------------------------------------------------------------- | ----------------------------------------- |
| 400         | Invalid input (missing fields, bad model name, context limit) | Fix request payload                       |
| 401         | Missing or expired JWT / invalid internal auth token          | Refresh token or check X-Internal-Auth    |
| 403         | Research belongs to a different user                          | Verify userId matches token               |
| 404         | Research not found / OpenRouter key not configured            | Verify ID exists or configure API key     |
| 409         | Status conflict (e.g., enhance on non-completed)              | Check status before calling               |
| 500         | Internal error                                                | Retry with backoff; check Sentry          |

## Events Published

| Topic env var                              | Event type         | When                                              | Key payload fields                        |
| ------------------------------------------ | ------------------ | ------------------------------------------------- | ----------------------------------------- |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | `research.process` | After `POST /` or draft approved          | `researchId`, `userId`, `triggeredBy`     |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | `llm.call`         | Once per model during process-research            | `researchId`, `userId`, `model`, `prompt` |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | WhatsApp send      | On LLM failure or research completion             | notification payload (`important: true`)  |

## Dependencies

| Service           | Why Needed                                            | Failure Behavior                               |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------- |
| user-service      | Fetch API keys; report LLM success analytics          | Research fails if keys unavailable             |
| llm-usage-service | Report LLM token usage and cost per call              | Usage not recorded; research unaffected        |
| image-service     | Generate cover image for share page                   | Skipped with provider failover; graceful       |
| notion-service    | Validate Notion page IDs; execute Notion export       | Export skipped if unavailable; fire-and-forget |
| whatsapp-service  | Send completion and failure notifications via Pub/Sub | Notification dropped; research unaffected      |
| OpenRouter API    | Route LLM calls; fetch live pricing catalog           | Call fails; pricing falls back to allowlist    |
| Cloud Pub/Sub     | Fan-out LLM calls; trigger processing pipeline        | Research stuck in pending/processing if down   |
| GCS               | Upload shareable HTML page                            | Share URL absent from completed research       |
