# research-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with research-agent.

---

## Identity

| Field    | Value                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| **Name** | research-agent                                                                       |
| **Role** | Multi-Model Research Orchestrator                                                    |
| **Goal** | Execute parallel LLM queries across 4 providers, synthesize results with attribution |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface ResearchAgentTools {
  // Create new research with parallel LLM queries
  createResearch(params: {
    prompt: string;
    selectedModels: ResearchModel[];
    synthesisModel?: ResearchModel;
    inputContexts?: { content: string; label?: string }[];
    skipSynthesis?: boolean;
  }): Promise<{ id: string; status: 'pending' }>;

  // Create draft research (internal - used by actions-agent)
  // v2.0.0: Supports natural language model extraction
  // v2.1.0: Uses @intexuraos/internal-clients for user service communication
  createDraftResearch(params: {
    prompt: string;
    originalMessage?: string; // For model preference extraction
    selectedModels?: ResearchModel[];
    synthesisModel?: ResearchModel;
    inputContexts?: { content: string; label?: string }[];
  }): Promise<{ id: string; status: 'draft'; selectedModels: ResearchModel[] }>;

  // Save research as draft for later
  saveDraft(params: {
    prompt: string;
    selectedModels?: ResearchModel[];
    synthesisModel?: ResearchModel;
    inputContexts?: { content: string; label?: string }[];
  }): Promise<{ id: string }>;

  // List user's researches
  listResearches(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ researches: Research[]; nextCursor?: string }>;

  // Get single research by ID
  getResearch(id: string): Promise<Research>;

  // Update draft research (PATCH /research/:id)
  updateDraft(
    id: string,
    params: {
      title?: string;
      prompt?: string;
      selectedModels?: ResearchModel[];
      synthesisModel?: ResearchModel;
      inputContexts?: { content: string; label?: string }[];
    }
  ): Promise<Research>;

  // Approve draft to start processing
  approveResearch(id: string): Promise<{ status: 'pending' }>;

  // Handle partial LLM failures
  confirmPartialFailure(
    id: string,
    params: {
      decision: 'proceed' | 'retry' | 'cancel';
    }
  ): Promise<{ decision: string; message: string }>;

  // Retry from failed status
  retryFromFailed(id: string): Promise<{
    action: 'retried_llms' | 'retried_synthesis' | 'already_completed';
    retriedModels?: string[];
  }>;

  // Enhance completed research with more models/contexts
  enhanceResearch(
    id: string,
    params: {
      additionalModels?: ResearchModel[];
      additionalContexts?: { content: string; label?: string }[];
      synthesisModel?: ResearchModel;
      removeContextIds?: string[];
    }
  ): Promise<{ id: string }>;

  // Delete research
  deleteResearch(id: string): Promise<void>;

  // Remove public share access
  unshareResearch(id: string): Promise<void>;

  // Toggle favourite status
  toggleFavourite(id: string, params: { favourite: boolean }): Promise<Research>;

  // Validate input quality before research
  // Returns quality 0 (rejected), 1 (weak, improvement available), 2 (good)
  // Structural checks reject malformed improvements (prefixes, JSON, length)
  validateInput(params: {
    prompt: string;
    includeImprovement?: boolean;
  }): Promise<{ quality: 0 | 1 | 2; reason: string; improvedPrompt?: string }>;

  // Force-improve input prompt
  improveInput(params: { prompt: string }): Promise<{ improvedPrompt: string }>;

  // Manually export completed research to Notion
  exportToNotion(id: string): Promise<Research>;

  // Get Notion export settings
  getNotionSettings(): Promise<{
    researchPageId: string | null;
    researchPageTitle: string | null;
    researchPageUrl: string | null;
  }>;

  // Save Notion export settings
  saveNotionSettings(params: {
    researchPageId: string;
    researchPageTitle: string;
    researchPageUrl: string;
  }): Promise<{
    researchPageId: string;
    researchPageTitle: string;
    researchPageUrl: string;
    createdAt: string;
    updatedAt: string;
  }>;

  // Validate a Notion page ID and get preview
  validateNotionPage(params: { researchPageId: string }): Promise<{ title: string; url: string }>;
}
```

### Types

```typescript
type ResearchModel =
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gpt-5.2'
  | 'o4-mini-deep-research'
  | 'claude-opus-4.5'
  | 'claude-sonnet-4.5'
  | 'sonar'
  | 'sonar-pro'
  | 'sonar-deep-research';

type ResearchStatus =
  | 'draft'
  | 'pending'
  | 'processing'
  | 'synthesizing'
  | 'awaiting_confirmation'
  | 'retrying'
  | 'completed'
  | 'failed';

interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  originalPrompt?: string;
  selectedModels: ResearchModel[];
  synthesisModel: ResearchModel;
  status: ResearchStatus;
  llmResults: LlmResult[];
  synthesizedResult?: string;
  researchContext?: ResearchContext;
  inputContexts?: InputContext[];
  shareInfo?: ShareInfo;
  favourite?: boolean;
  notionExportInfo?: NotionExportInfo;
  attributionStatus?: 'complete' | 'incomplete' | 'repaired';
  totalCostUsd?: number;
  auxiliaryCostUsd?: number;
  sourceLlmCostUsd?: number;
  sourceResearchId?: string;
  startedAt: string;
  completedAt?: string;
}

interface NotionExportInfo {
  mainPageId: string;
  mainPageUrl: string;
  llmReportPageIds: { model: string; pageId: string }[];
  exportedAt: string;
}

interface LlmResult {
  provider: LlmProvider;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  sources?: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  copiedFromSource?: boolean;
}

type LlmProvider = 'anthropic' | 'openai' | 'google' | 'perplexity';

interface InputContext {
  id: string;
  content: string;
  label?: string;
  addedAt: string;
}

interface ShareInfo {
  shareToken: string;
  slug: string;
  shareUrl: string;
  sharedAt: string;
  gcsPath: string;
  coverImageId?: string;
  coverImageUrl?: string;
}

interface ResearchContext {
  language: string;
  domain: string;
  mode: 'compact' | 'standard' | 'audit';
  intent_summary: string;
  answer_style: string[];
  time_scope?: { as_of_date: string; prefers_recent_years: number; is_time_sensitive: boolean };
  locale_scope?: { country: string; region?: string };
  research_plan?: { key_questions: string[]; preferred_source_types: string[] };
}

interface InputQualityResult {
  quality: 0 | 1 | 2; // 0: rejected, 1: weak (improvement available), 2: good
  reason: string;
  improvedPrompt?: string; // Only when quality === 1 and includeImprovement === true
}
```

---

## Model Selection

### Natural Language Extraction

When creating draft research via actions-agent, model preferences are extracted from the user's original message.

**Recognized Keywords:**

| Keyword               | Model Selected    | Provider   |
| --------------------- | ----------------- | ---------- |
| "claude", "anthropic" | `claude-opus-4.5` | anthropic  |
| "gpt", "openai"       | `gpt-5.2`         | openai     |
| "gemini", "google"    | `gemini-2.5-pro`  | google     |
| "perplexity", "sonar" | `sonar-pro`       | perplexity |
| "deep research"       | deep variants     | varies     |
| "fast", "flash"       | flash/mini        | varies     |

### API Key Filtering

Extracted models are filtered by user's configured API keys (via `@intexuraos/internal-clients`):

```typescript
// Example: User says "Use Claude and Gemini"
// User has: Google API key, OpenAI API key (NO Anthropic key)
// Result: selectedModels = ['gemini-2.5-pro']
// (Claude excluded because no anthropic API key)
```

### One Model Per Provider

The system enforces maximum one model per provider:

```typescript
// User says "Use GPT and o4-mini-deep-research"
// Both are OpenAI models
// Result: Only one is selected (first match wins)
```

### Platform API Key Fallbacks

When a user has no API key for a provider, `getLlmClient` tries platform-owned keys:

```typescript
// Fallback resolution order:
// 1. User's own API key
// 2. Platform Gemini key -> 'gemini-2.0-flash' (if INTEXURAOS_GEMINI_APP_API_KEY set)
// 3. Error: NO_API_KEY
```

### Graceful Degradation

Model extraction failures do not block draft creation:

- If LLM extraction fails: Empty selectedModels array returned
- If no API keys match: Empty selectedModels array returned
- User can manually select models in web UI

---

## Constraints

| Rule                       | Description                                                    |
| -------------------------- | -------------------------------------------------------------- |
| **API Keys Required**      | User must have API keys configured for selected models         |
| **One Model Per Provider** | Maximum one model from each provider                           |
| **At Least One Source**    | Research requires either models or input contexts              |
| **Synthesis Model Key**    | Synthesis model's provider API key must be available           |
| **Draft Before Approve**   | Can only approve researches in 'draft' status                  |
| **Retry Only Failed**      | Can only retry from 'failed' or 'awaiting_confirmation' status |
| **Enhance Only Completed** | Can only enhance 'completed' researches                        |
| **Max 5 Contexts**         | Up to 5 input contexts, each max 60,000 characters             |
| **Max 6 Models**           | Up to 6 selected models per research                           |

---

## Usage Patterns

### Basic Research Flow

```typescript
// 1. Create research
const { id } = await createResearch({
  prompt: 'What are the implications of quantum computing on cryptography?',
  selectedModels: ['gemini-2.5-pro', 'claude-opus-4.5', 'sonar-pro'],
  synthesisModel: 'gemini-2.5-pro',
});

// 2. Poll for completion
let research = await getResearch(id);
while (research.status === 'pending' || research.status === 'processing') {
  await sleep(5000);
  research = await getResearch(id);
}

// 3. Handle result
if (research.status === 'completed') {
  console.log(research.synthesizedResult);
}
```

### Validate-Then-Create Flow

```typescript
// 1. Validate input quality
const validation = await validateInput({
  prompt: userInput,
  includeImprovement: true,
});

// 2. Use improved prompt if quality is weak
const finalPrompt = validation.quality === 1 && validation.improvedPrompt
  ? validation.improvedPrompt
  : userInput;

// 3. Reject if quality is 0
if (validation.quality === 0) {
  throw new Error(`Prompt rejected: ${validation.reason}`);
}

// 4. Create research with validated prompt
const { id } = await createResearch({
  prompt: finalPrompt,
  originalPrompt: validation.quality === 1 ? userInput : undefined,
  selectedModels: ['gemini-2.5-pro'],
  synthesisModel: 'gemini-2.5-pro',
});
```

### Natural Language Model Selection

```typescript
// Via actions-agent with natural language
// User message: "Use Claude and Gemini to research quantum computing"

// actions-agent calls:
const { id, selectedModels } = await createDraftResearch({
  prompt: 'Research quantum computing',
  originalMessage: 'Use Claude and Gemini to research quantum computing',
});

// selectedModels will be ['claude-opus-4.5', 'gemini-2.5-pro']
// (if user has both API keys configured)
```

### Draft and Approve Flow

```typescript
// 1. Save draft
const { id } = await saveDraft({
  prompt: 'Draft prompt to refine later',
});

// 2. Update draft (via PATCH /research/:id)
await updateDraft(id, {
  selectedModels: ['gemini-2.5-flash'],
});

// 3. Approve when ready
await approveResearch(id);
```

### Handle Partial Failures

```typescript
const research = await getResearch(id);
if (research.status === 'awaiting_confirmation') {
  // Some models failed - user must decide
  await confirmPartialFailure(id, { decision: 'proceed' }); // Use successful results
  // OR
  await confirmPartialFailure(id, { decision: 'retry' }); // Retry failed models
  // OR
  await confirmPartialFailure(id, { decision: 'cancel' }); // Cancel research
}
```

---

## Public Endpoints

| Method | Path                                 | Purpose                        |
| ------ | ------------------------------------ | ------------------------------ |
| POST   | `/research`                          | Create new research            |
| POST   | `/research/draft`                    | Save as draft                  |
| PATCH  | `/research/:id`                      | Update draft                   |
| GET    | `/research`                          | List researches                |
| GET    | `/research/:id`                      | Get research by ID             |
| DELETE | `/research/:id`                      | Delete research                |
| POST   | `/research/:id/approve`              | Approve draft                  |
| POST   | `/research/:id/enhance`              | Enhance completed research     |
| POST   | `/research/:id/retry`                | Retry failed LLMs              |
| POST   | `/research/:id/confirm`              | Confirm partial failure        |
| POST   | `/research/:id/export-notion`        | Export to Notion               |
| DELETE | `/research/:id/share`                | Remove public sharing          |
| PATCH  | `/research/:id/favourite`            | Toggle favourite               |
| POST   | `/research/validate-input`           | Validate input quality         |
| POST   | `/research/improve-input`            | Improve research prompt        |
| GET    | `/research/settings/notion`          | Get Notion export settings     |
| POST   | `/research/settings/notion`          | Save Notion export settings    |
| POST   | `/research/settings/notion/validate` | Validate Notion page ID        |

## Internal Endpoints

| Method | Path                                    | Purpose                                     |
| ------ | --------------------------------------- | ------------------------------------------- |
| POST   | `/internal/research/draft`              | Create draft with model extraction          |
| POST   | `/internal/llm/pubsub/process-research` | Process research from Pub/Sub               |
| POST   | `/internal/llm/pubsub/process-llm-call` | Process individual LLM call                 |
| POST   | `/internal/llm/pubsub/report-analytics` | Report LLM analytics                        |

---

## Error Handling

### Input Validation Errors

| Error                        | Cause                                      | Resolution                         |
| ---------------------------- | ------------------------------------------ | ---------------------------------- |
| Quality 0 (rejected)         | Prompt too vague or inappropriate          | Rewrite with more specificity      |
| Malformed improvement        | LLM returned invalid format (prefix, JSON) | System retries automatically       |

### Model Selection Errors

| Error                    | Cause                               | Resolution                         |
| ------------------------ | ----------------------------------- | ---------------------------------- |
| Empty selectedModels     | No recognized models or no API keys | User selects manually in web UI    |
| Model extraction timeout | LLM inference took too long         | Graceful degradation to empty list |
| Zod validation failure   | LLM returned malformed context      | Parser + repair pattern retries    |

### Research Errors

| Error Code        | Cause                      | Resolution                         |
| ----------------- | -------------------------- | ---------------------------------- |
| `NOT_FOUND`       | Research ID does not exist | Verify ID and ownership            |
| `INVALID_REQUEST` | Missing required fields    | Check request body                 |
| `PARTIAL_FAILURE` | Some LLM calls failed      | Use confirmPartialFailure endpoint |
| `SYNTHESIS_ERROR` | Synthesis LLM call failed  | Check synthesis model API key      |

---

## State Machine

```
draft --approve--> pending --process--> processing --all_complete--> synthesizing --synth_done--> completed
                                            |                            |
                                            | partial_failure            | synth_error
                                            v                            v
                                     awaiting_confirmation            failed
                                            |
                                            | proceed/retry/cancel
                                            v
                                   synthesizing / retrying / failed
```

---

## Dependencies

| Package                        | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `@intexuraos/internal-clients` | User service client                                  |
| `@intexuraos/infra-notion`     | Notion client and error mapping                      |
| `@intexuraos/infra-otel`       | Dash0 OpenTelemetry preload instrumentation          |
| `@intexuraos/infra-sentry`     | Sentry-enabled logger factory                        |
| `@intexuraos/llm-contract`     | Model types, provider mapping                        |
| `@intexuraos/llm-prompts`      | Zod schemas, prompt builders                         |
| `@intexuraos/llm-pricing`      | Pricing context interface                            |
| `@intexuraos/llm-utils`        | Parse error formatting                               |
| `@intexuraos/infra-gemini`     | Gemini client wrapper                                |
| `@intexuraos/common-http`      | HTTP utilities, auth                                 |
| `@intexuraos/common-core`      | Result types, logging                                |

---

**Last updated:** 2026-03-07 (v3.1.0)
