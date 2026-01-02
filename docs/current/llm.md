# LLM Usage

> **Auto-generated documentation** - Do not edit manually.
> Last updated: 2026-01-02

IntexuraOS uses multiple LLM providers for research, synthesis, and text generation.

## Architecture Overview

The LLM system follows a two-layer architecture:

1. **Base Layer (`LLMClient`)** - Generic interface in `llm-contract` with 3 core methods
2. **Adapter Layer** - Domain-specific extensions in `llm-orchestrator` for synthesis and title generation

## Providers Summary

| Provider  | Package        | Required | Primary Use Case    | Research Model             | Default Model                | Evaluate Model              |
| --------- | -------------- | -------- | ------------------- | -------------------------- | ---------------------------- | --------------------------- |
| Google    | `infra-gemini` | No       | Research, Synthesis | `gemini-2.5-pro`           | `gemini-2.5-flash`           | `gemini-2.5-flash-lite`     |
| Anthropic | `infra-claude` | No       | Research            | `claude-opus-4-5-20251101` | `claude-sonnet-4-5-20250929` | `claude-haiku-4-5-20251001` |
| OpenAI    | `infra-gpt`    | No       | Research            | `o4-mini-deep-research`    | `gpt-5.2`                    | `gpt-5-nano`                |

**Note:** All providers are optional. Users configure which providers they want via API keys in settings.

## Core Interface (`LLMClient`)

**Location:** `packages/llm-contract/src/types.ts`

```typescript
export interface LLMClient {
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;
  generate(prompt: string): Promise<Result<string, LLMError>>;
  evaluate(prompt: string): Promise<Result<string, LLMError>>;
}
```

### Method → Model Mapping

| Method       | Model Config    | Purpose                                  | Token Limit |
| ------------ | --------------- | ---------------------------------------- | ----------- |
| `research()` | `researchModel` | Web-enabled research with sources        | 8192        |
| `generate()` | `defaultModel`  | Standard text generation, synthesis      | 8192        |
| `evaluate()` | `evaluateModel` | Fast validation, scoring, classification | 500         |

## Provider Details

### Google Gemini

| Aspect          | Value                                                  |
| --------------- | ------------------------------------------------------ |
| **Package**     | `packages/infra-gemini`                                |
| **SDK**         | `@google/genai`                                        |
| **API Key Env** | User-specific (stored encrypted in Firestore)          |
| **Adapter**     | `apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts` |

**Models:**

```typescript
export const GEMINI_DEFAULTS = {
  researchModel: 'gemini-2.5-pro',
  defaultModel: 'gemini-2.5-flash',
  evaluateModel: 'gemini-2.5-flash-lite',
} as const;
```

**Capabilities:**

- `research(prompt)` — Web-grounded research with sources from grounding metadata
- `generate(prompt)` — Simple text generation
- `evaluate(prompt)` — Fast evaluation/validation tasks

**Web Search Tool:** Native `googleSearch` tool with grounding metadata
**Source Extraction:** `response.candidates[0].groundingMetadata.groundingChunks[].web.uri`

### Anthropic Claude

| Aspect          | Value                                                  |
| --------------- | ------------------------------------------------------ |
| **Package**     | `packages/infra-claude`                                |
| **SDK**         | `@anthropic-ai/sdk`                                    |
| **API Key Env** | User-specific (stored encrypted in Firestore)          |
| **Adapter**     | `apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts` |

**Models:**

```typescript
export const CLAUDE_DEFAULTS = {
  researchModel: 'claude-opus-4-5-20251101',
  defaultModel: 'claude-sonnet-4-5-20250929',
  evaluateModel: 'claude-haiku-4-5-20251001',
} as const;
```

**Capabilities:**

- `research(prompt)` — Research with web search tool
- `generate(prompt)` — Text generation
- `evaluate(prompt)` — Fast evaluation/validation tasks

**Web Search Tool:** `web_search_20250305` (date-versioned tool)
**Source Extraction:** URL regex from text + `web_search_tool_result` blocks

### OpenAI GPT

| Aspect          | Value                                               |
| --------------- | --------------------------------------------------- |
| **Package**     | `packages/infra-gpt`                                |
| **SDK**         | `openai`                                            |
| **API Key Env** | User-specific (stored encrypted in Firestore)       |
| **Adapter**     | `apps/llm-orchestrator/src/infra/llm/GptAdapter.ts` |

**Models:**

```typescript
export const GPT_DEFAULTS = {
  researchModel: 'o4-mini-deep-research',
  defaultModel: 'gpt-5.2',
  evaluateModel: 'gpt-5-nano',
} as const;
```

**Capabilities:**

- `research(prompt)` — Research with web search preview tool
- `generate(prompt)` — Text generation
- `evaluate(prompt)` — Fast evaluation/validation tasks

**Web Search Tool:** `web_search_preview` with context size parameter
**Source Extraction:** `output[].results[].url` from `web_search_call` items
**Note:** Uses Responses API for research, Chat Completions for generate/evaluate

## Research Flow

```
User Submits Research
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ processResearch.ts                                          │
│  ├─ Title generation (Google preferred, fallback to synth) │
│  └─ Publish llm.call events to Pub/Sub (one per provider)  │
└─────────────────────────────────────────────────────────────┘
    │
    ▼ (parallel Pub/Sub events)
┌─────────────────────────────────────────────────────────────┐
│ /internal/llm/pubsub/process-llm-call (Cloud Run instances) │
│  ├─ Fetch API keys from user-service                        │
│  ├─ Create provider adapter (Claude/GPT/Gemini)            │
│  ├─ Call adapter.research(prompt)                          │
│  ├─ Calculate cost (token usage × pricing)                 │
│  └─ checkLlmCompletion()                                   │
│       ├─ All completed? → runSynthesis()                   │
│       ├─ All failed? → Mark research failed                │
│       └─ Partial failure? → Await user decision            │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ runSynthesis.ts                                             │
│  ├─ Gather completed results + external reports            │
│  ├─ Build synthesis prompt (buildSynthesisPrompt)          │
│  ├─ Call synthesizer.synthesize()                          │
│  └─ Notify user                                            │
└─────────────────────────────────────────────────────────────┘
```

## Adapter Layer (Extended Interface)

**Location:** `apps/llm-orchestrator/src/infra/llm/`

Adapters wrap the base `LLMClient` and add domain-specific methods:

| Method            | Built On     | Purpose                            |
| ----------------- | ------------ | ---------------------------------- |
| `research()`      | `research()` | Direct delegation to client        |
| `synthesize()`    | `generate()` | Combines multiple research results |
| `generateTitle()` | `generate()` | Creates short title for research   |

### Synthesis Prompt Builder

**Location:** `packages/common-core/src/prompts/synthesisPrompt.ts`

```typescript
function buildSynthesisPrompt(
  originalPrompt: string,
  reports: { model: string; content: string }[],
  externalReports?: { content: string }[]
): string;
```

**Prompt Structure:**

1. Original Research Prompt
2. External Reports (if provided, with conflict resolution guidelines)
3. System Reports (from Claude, GPT, Gemini)
4. Synthesis Task instructions

### Factory Pattern

**Location:** `apps/llm-orchestrator/src/infra/llm/LlmAdapterFactory.ts`

| Function                   | Purpose                                    | Returns                                    |
| -------------------------- | ------------------------------------------ | ------------------------------------------ |
| `createLlmProviders()`     | Create adapters for all available API keys | `Record<LlmProvider, LlmResearchProvider>` |
| `createSynthesizer()`      | Create synthesizer for specific provider   | `LlmSynthesisProvider`                     |
| `createTitleGenerator()`   | Create title generator (always Gemini)     | `TitleGenerator`                           |
| `createResearchProvider()` | Create research provider with search mode  | `LlmResearchProvider`                      |

## Search Mode

| Mode    | Model Used      | Use Case                          |
| ------- | --------------- | --------------------------------- |
| `deep`  | `researchModel` | Full research with web search     |
| `quick` | `defaultModel`  | Faster research with faster model |

Factory logic:

```typescript
if (searchMode === 'quick') {
  // Override researchModel with defaultModel
  return new GeminiAdapter(apiKey, GEMINI_DEFAULTS.defaultModel);
}
return new GeminiAdapter(apiKey); // Uses researchModel
```

## API Key Validation

**Location:** `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`

API key validation uses the fast `evaluate()` method (not `research()`):

```typescript
const VALIDATION_PROMPT = 'Say "API key validated" in exactly 3 words.';

async validateKey(provider: LlmProvider, apiKey: string): Promise<Result<void, LlmValidationError>> {
  const client = createClient(provider, apiKey);
  const result = await client.evaluate(VALIDATION_PROMPT);
  // Maps INVALID_KEY errors appropriately
}
```

**Why `evaluate()`?**

- Uses fastest/cheapest model (`evaluateModel`)
- Response time: ~1-2 seconds vs 30+ seconds for `research()`
- Minimal token usage

## Audit System

**Package:** `packages/llm-audit`

All LLM calls are audited to Firestore `llm_api_logs` collection.

### Audit Fields

| Field          | Description                        |
| -------------- | ---------------------------------- |
| `provider`     | `google`, `openai`, `anthropic`    |
| `model`        | Model identifier                   |
| `method`       | `research`, `generate`, `evaluate` |
| `prompt`       | Input prompt (full text)           |
| `promptLength` | Character count                    |
| `response`     | Output (on success)                |
| `error`        | Error message (on failure)         |
| `inputTokens`  | Tokens in prompt                   |
| `outputTokens` | Tokens in response                 |
| `durationMs`   | Call duration                      |
| `status`       | `success` or `error`               |
| `userId`       | Optional user context              |
| `researchId`   | Optional research context          |

### Audit Flow

```typescript
// 1. Create context before API call
const auditContext = createAuditContext({
  provider: 'anthropic',
  model: 'claude-opus-4-5-20251101',
  method: 'research',
  prompt: researchPrompt,
  startedAt: new Date(),
});

try {
  // 2. Make API call
  const response = await client.messages.create({
    /* ... */
  });

  // 3. Log success
  await auditContext.success({
    response: content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
} catch (error) {
  // 3. Log error
  await auditContext.error({ error: errorMessage });
}
```

### Configuration

**Environment Variable:** `INTEXURAOS_AUDIT_LLMS`

- Default: `true` (auditing enabled)
- Set to `false`, `0`, or `no` to disable

## Error Handling

### Error Codes

| Code             | HTTP Status | Description               | Handling           |
| ---------------- | ----------- | ------------------------- | ------------------ |
| `INVALID_KEY`    | 401         | API key invalid/expired   | Notify user        |
| `RATE_LIMITED`   | 429         | Provider rate limit hit   | Retry with backoff |
| `TIMEOUT`        | -           | Request timed out         | Skip provider      |
| `OVERLOADED`     | 529         | Claude service overloaded | Skip provider      |
| `CONTEXT_LENGTH` | 400         | GPT context exceeded      | Skip provider      |
| `API_ERROR`      | 5xx         | Generic provider error    | Skip provider      |

### Error Mapping by Provider

**Claude:**

- 401 → `INVALID_KEY`
- 429 → `RATE_LIMITED`
- 529 → `OVERLOADED`
- Message contains "timeout" → `TIMEOUT`

**GPT:**

- 401 → `INVALID_KEY`
- 429 → `RATE_LIMITED`
- Code `context_length_exceeded` → `CONTEXT_LENGTH`
- Message contains "timeout" → `TIMEOUT`

**Gemini:**

- Message contains "API_KEY" → `INVALID_KEY`
- 429 or "quota" → `RATE_LIMITED`
- Message contains "timeout" → `TIMEOUT`

## Partial Failure Handling

When some providers fail but others succeed:

1. Research status set to `awaiting_confirmation`
2. Failed providers stored with detection timestamp
3. User can choose:
   - **Retry** - Re-dispatch failed providers (max 2 retries)
   - **Proceed** - Run synthesis with partial results

**Location:** `apps/llm-orchestrator/src/domain/research/usecases/retryFailedLlms.ts`

## API Key Management

| Aspect         | Implementation                               |
| -------------- | -------------------------------------------- |
| **Storage**    | Firestore `user_settings` collection         |
| **Encryption** | AES-256-GCM with `INTEXURAOS_ENCRYPTION_KEY` |
| **Format**     | `iv:authTag:ciphertext` (all base64)         |
| **Access**     | Via `user-service` internal API              |
| **Masking**    | First 4 + last 4 chars shown in UI           |

**Key Configuration Endpoints** (user-service):

| Endpoint                                       | Method | Purpose              |
| ---------------------------------------------- | ------ | -------------------- |
| `/users/:uid/settings/llm-keys`                | GET    | Get masked keys      |
| `/users/:uid/settings/llm-keys`                | PATCH  | Add/update key       |
| `/users/:uid/settings/llm-keys/:provider/test` | POST   | Test key with prompt |
| `/users/:uid/settings/llm-keys/:provider`      | DELETE | Remove key           |

## Code Examples

### Creating a Client

```typescript
import { createGeminiClient } from '@intexuraos/infra-gemini';

const client = createGeminiClient({ apiKey: 'your-api-key' });

// Research with web search
const research = await client.research('What is quantum computing?');
if (research.ok) {
  console.log(research.value.content);
  console.log(research.value.sources); // URLs from grounding
}

// Simple generation
const text = await client.generate('Summarize this...');

// Fast evaluation
const score = await client.evaluate('Rate this content 1-10...');
```

### Using Adapters

```typescript
import { GeminiAdapter } from './infra/llm/GeminiAdapter';
import { buildSynthesisPrompt } from '@intexuraos/common-core';

const adapter = new GeminiAdapter(apiKey);

// Research
const research = await adapter.research(prompt);

// Synthesize multiple results
const synthesis = await adapter.synthesize(
  originalPrompt,
  [
    { model: 'claude', content: claudeResult },
    { model: 'gpt', content: gptResult },
  ],
  externalContexts // Optional
);

// Generate title
const title = await adapter.generateTitle(prompt);
```

### Parallel Research Execution

```typescript
// From LlmAdapterFactory.ts
const providers = createLlmProviders(userKeys, searchMode);

// Dispatch to Pub/Sub for parallel execution
for (const [provider, _] of Object.entries(providers)) {
  await llmCallPublisher.publish({
    researchId,
    userId,
    provider,
    prompt,
  });
}
```

## Key Files Reference

| File                                                       | Purpose                    |
| ---------------------------------------------------------- | -------------------------- |
| `packages/llm-contract/src/types.ts`                       | Core `LLMClient` interface |
| `packages/infra-claude/src/client.ts`                      | Claude implementation      |
| `packages/infra-gpt/src/client.ts`                         | GPT implementation         |
| `packages/infra-gemini/src/client.ts`                      | Gemini implementation      |
| `packages/llm-audit/src/audit.ts`                          | Audit logging              |
| `packages/common-core/src/prompts/synthesisPrompt.ts`      | Synthesis prompt builder   |
| `packages/common-core/src/prompts/researchPrompt.ts`       | Research prompt builder    |
| `apps/llm-orchestrator/src/infra/llm/*Adapter.ts`          | Provider adapters          |
| `apps/llm-orchestrator/src/infra/llm/LlmAdapterFactory.ts` | Factory functions          |
| `apps/llm-orchestrator/src/domain/research/usecases/*.ts`  | Research orchestration     |
| `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`      | API key validation         |
