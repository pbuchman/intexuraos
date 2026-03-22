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

**Endpoint:** `POST /research`

**Auth:** Bearer JWT

**When to use:** When you need a research question answered by multiple LLM providers and synthesized into one document.

**Input Schema:**

```typescript
interface SubmitResearchInput {
  prompt: string;                  // Research question (min 1 char)
  selectedModels: ResearchModel[]; // Models to use for research
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
  "selectedModels": ["gemini-2.5-pro", "claude-sonnet-4-5"],
  "synthesisModel": "gemini-2.5-pro"
}

// Response
{
  "success": true,
  "data": {
    "id": "res_abc123",
    "status": "pending",
    "title": "",
    "selectedModels": ["gemini-2.5-pro", "claude-sonnet-4-5"],
    "llmResults": [
      { "model": "gemini-2.5-pro", "status": "pending" },
      { "model": "claude-sonnet-4-5", "status": "pending" }
    ],
    "startedAt": "2026-03-15T10:00:00.000Z"
  }
}
```

---

### Get Research

**Endpoint:** `GET /research/:id`

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
  provider: string;
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

### Confirm Partial Failure

**Endpoint:** `POST /research/:id/confirm`

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

**Endpoint:** `POST /research/:id/enhance`

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

### Create Draft Research (Internal)

**Endpoint:** `POST /internal/research/draft`

**Auth:** `X-Internal-Auth` header

**When to use:** When another service (e.g., actions-agent) wants to create a research that requires user approval before LLM calls are made.

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

**Requires:**

- User must have LLM API keys configured in user-service for the selected models
- Synthesis model API key must be present — missing key causes immediate `failed` status
- Notion export requires `POST /research/settings/notion` to be configured first

## Usage Patterns

### Pattern 1: Submit and Poll to Completion

```
1. POST /research -> receive researchId
2. GET /research/:id every 5 seconds
3. If status === 'awaiting_confirmation':
   a. Read partialFailure.failedModels
   b. POST /research/:id/confirm with { decision: 'proceed' | 'retry' | 'cancel' }
4. Wait for status === 'completed' or 'failed'
5. Read synthesizedResult and shareInfo.shareUrl
```

### Pattern 2: Internal Draft Creation (from another service)

```
1. POST /internal/research/draft with userId, title, prompt, originalMessage
2. Response includes resourceUrl = "/#/research/{id}"
3. User visits dashboard, reviews draft, clicks approve
4. Research moves to pending -> processing -> completed
```

### Pattern 3: Incremental Enhancement

```
1. Ensure source research status === 'completed'
2. POST /research/:sourceId/enhance with additionalModels and/or additionalContexts
3. Poll new research ID to completion
4. Compare totalCostUsd vs sourceLlmCostUsd to see incremental spend
```

## Error Handling

| HTTP Status | Meaning                                                       | Recovery                                  |
| ----------- | ------------------------------------------------------------- | ----------------------------------------- |
| 400         | Invalid input (missing fields, bad model name, context limit) | Fix request payload                       |
| 401         | Missing or expired JWT / invalid internal auth token          | Refresh token or check X-Internal-Auth    |
| 403         | Research belongs to a different user                          | Verify userId matches token               |
| 404         | Research not found                                            | Verify ID exists                          |
| 409         | Status conflict (e.g., enhance on non-completed)              | Check status before calling               |
| 500         | Internal error                                                | Retry with backoff; check Sentry          |

## Events Published

| Topic env var                              | Event type         | When                                              | Key payload fields                        |
| ------------------------------------------ | ------------------ | ------------------------------------------------- | ----------------------------------------- |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | `research.process` | After `POST /research` or draft approved          | `researchId`, `userId`, `triggeredBy`     |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | `llm.call`         | Once per model during process-research            | `researchId`, `userId`, `model`, `prompt` |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | WhatsApp send      | On LLM failure or research completion             | notification payload                      |

## Dependencies

| Service              | Why Needed                                            | Failure Behavior                               |
| -------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| user-service         | Fetch API keys; report LLM success analytics          | Research fails if keys unavailable             |
| app-settings-service | Load LLM pricing at startup                           | Service fails to start if unreachable          |
| image-service        | Generate cover image for share page                   | Skipped gracefully; research still completes   |
| notion-service       | Validate Notion page IDs; execute Notion export       | Export skipped if unavailable; fire-and-forget |
| whatsapp-service     | Send completion and failure notifications via Pub/Sub | Notification dropped; research unaffected      |
| Cloud Pub/Sub        | Fan-out LLM calls; trigger processing pipeline        | Research stuck in pending/processing if down   |
| GCS                  | Upload shareable HTML page                            | Share URL absent from completed research       |
