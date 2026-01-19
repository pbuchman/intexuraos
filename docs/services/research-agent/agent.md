# research-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with research-agent.

---

## Identity

| Field | Value |
| ----- | ----- |
| **Name** | research-agent |
| **Role** | Multi-Model Research Orchestrator |
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
  confirmPartialFailure(id: string, params: {
    action: 'proceed' | 'retry' | 'cancel';
  }): Promise<{ action: string; message: string }>;

  // Retry from failed status
  retryFromFailed(id: string): Promise<{
    action: 'retried_llms' | 'retried_synthesis' | 'already_completed';
    retriedModels?: string[];
  }>;

  // Enhance completed research with more models/contexts
  enhanceResearch(id: string, params: {
    additionalModels?: ResearchModel[];
    additionalContexts?: { content: string; label?: string }[];
    synthesisModel?: ResearchModel;
    removeContextIds?: string[];
  }): Promise<{ id: string }>;

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
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929'
  | 'sonar'
  | 'sonar-pro'
  | 'sonar-deep-research'
  | 'glm-4.7';

type ResearchStatus =
  | 'draft'
  | 'pending'
  | 'processing'
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
  synthesis?: string;
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
```

---

## Constraints

| Rule | Description |
| ---- | ----------- |
| **API Keys Required** | User must have API keys configured for selected models |
| **At Least One Source** | Research requires either models or input contexts |
| **Synthesis Model Key** | Synthesis model's provider API key must be available |
| **Draft Before Approve** | Can only approve researches in 'draft' status |
| **Retry Only Failed** | Can only retry from 'failed' or 'awaiting_confirmation' status |
| **Enhance Only Completed** | Can only enhance 'completed' researches |

---

## Usage Patterns

### Basic Research Flow

```typescript
// 1. Create research
const { id } = await createResearch({
  prompt: 'What are the implications of quantum computing on cryptography?',
  selectedModels: ['gemini-2.5-pro', 'claude-opus-4-5-20251101', 'sonar-pro'],
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
  console.log(research.synthesis);
}
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

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/internal/research/:id/llm-result` | Receive LLM result from Pub/Sub worker |
| GET | `/internal/research/:id` | Get research for internal services |

---

**Last updated:** 2026-01-19
