# research-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with research-agent.

---

## Identity

| Field    | Value                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| **Name** | research-agent                                                                       |
| **Role** | Multi-Model Research Orchestrator                                                    |
| **Goal** | Execute parallel LLM queries across 5 providers, synthesize results with attribution |

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

  // Approve draft to start processing
  approveResearch(id: string): Promise<{ status: 'pending' }>;

  // Handle partial LLM failures
  confirmPartialFailure(
    id: string,
    params: {
      action: 'proceed' | 'retry' | 'cancel';
    }
  ): Promise<{ action: string; message: string }>;

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
  validateInput(params: {
    prompt: string;
    includeImprovement?: boolean;
  }): Promise<{ quality: 0 | 1 | 2; reason: string; improvedPrompt?: string }>;

  // Force-improve input prompt
  improveInput(params: { prompt: string }): Promise<{ improvedPrompt: string }>;
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
  | 'sonar-deep-research'
  | 'glm-4.7';

type ResearchStatus =
  | 'draft'
  | 'pending'
  | 'processing'
  | 'synthesizing'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed';

interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  selectedModels: ResearchModel[];
  synthesisModel: ResearchModel;
  status: ResearchStatus;
  llmResults: Record<ResearchModel, LlmResult>;
  synthesizedResult?: string;
  researchContext?: ResearchContext; // v2.0.0: Zod-validated context
  synthesisContext?: SynthesisContext; // v2.0.0: Zod-validated context
  inputContexts?: InputContext[];
  shareInfo?: ShareInfo;
  favourite?: boolean;
  createdAt: string;
  completedAt?: string;
}

interface LlmResult {
  status: 'pending' | 'completed' | 'failed';
  content?: string;
  error?: string;
  tokenUsage?: { input: number; output: number };
}

// v2.0.0: Zod-validated context types
interface ResearchContext {
  language: string;
  domain: 'technical' | 'business' | 'academic' | 'creative' | 'general';
  mode: 'deep_dive' | 'quick_answer' | 'comparison' | 'standard';
  intent_summary: string;
  answer_style: AnswerStyle[];
  time_scope?: TimeScope;
  locale_scope?: LocaleScope;
  research_plan?: ResearchPlan;
}

interface SynthesisContext {
  synthesis_goal: SynthesisGoal;
  detected_conflicts?: DetectedConflict[];
}
```

---

## Model Selection (v2.0.0)

### Natural Language Extraction

When creating draft research via actions-agent, model preferences are extracted from the user's original message.

**Recognized Keywords:**

| Keyword               | Model Selected    | Provider   |
| --------------------- | ----------------- | ---------- |
| "claude", "anthropic" | `claude-opus-4.5` | anthropic  |
| "gpt", "openai"       | `gpt-5.2`         | openai     |
| "gemini", "google"    | `gemini-2.5-pro`  | google     |
| "perplexity", "sonar" | `sonar-pro`       | perplexity |
| "glm", "zai"          | `glm-4.7`         | zai        |
| "deep research"       | deep variants     | varies     |
| "fast", "flash"       | flash/mini        | varies     |

### API Key Filtering

Extracted models are filtered by user's configured API keys:

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
| **One Model Per Provider** | Maximum one model from each provider (v2.0.0)                  |
| **At Least One Source**    | Research requires either models or input contexts              |
| **Synthesis Model Key**    | Synthesis model's provider API key must be available           |
| **Draft Before Approve**   | Can only approve researches in 'draft' status                  |
| **Retry Only Failed**      | Can only retry from 'failed' or 'awaiting_confirmation' status |
| **Enhance Only Completed** | Can only enhance 'completed' researches                        |

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

### Natural Language Model Selection (v2.0.0)

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
// 3. Approve when ready
await approveResearch(id);
```

### Handle Partial Failures

```typescript
const research = await getResearch(id);
if (research.status === 'awaiting_confirmation') {
  // Some models failed - user must decide
  await confirmPartialFailure(id, { action: 'proceed' }); // Use successful results
  // OR
  await confirmPartialFailure(id, { action: 'retry' }); // Retry failed models
  // OR
  await confirmPartialFailure(id, { action: 'cancel' }); // Cancel research
}
```

---

## Internal Endpoints

| Method | Path                                | Purpose                                     |
| ------ | ----------------------------------- | ------------------------------------------- |
| POST   | `/internal/research/draft`          | Create draft with model extraction (v2.0.0) |
| POST   | `/internal/research/:id/llm-result` | Receive LLM result from Pub/Sub worker      |
| GET    | `/internal/research/:id`            | Get research for internal services          |

---

## Error Handling

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
draft ──approve──> pending ──process──> processing ──all_complete──> synthesizing ──synth_done──> completed
                      │                     │                            │
                      │                     │ partial_failure            │ synth_error
                      │                     v                            v
                      │              awaiting_confirmation            failed
                      │                     │
                      │                     │ proceed/retry/cancel
                      │                     v
                      └─────────────> [varies by decision]
```

---

**Last updated:** 2026-01-24
