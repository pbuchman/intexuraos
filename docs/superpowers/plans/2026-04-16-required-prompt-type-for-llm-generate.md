# Required Prompt Type for LLM Generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify LLM client interface and all invocations so prompt type tracking is mandatory for every LLM generate call.

**Architecture:** Breaking interface change across packages layer (llm-factory, infra-* clients) requiring all downstream apps/workers to pass promptType. Uses PromptBuilder.name as the canonical prompt type identifier where available, otherwise defines semantic string constants.

**Tech Stack:** TypeScript, Result types, PromptBuilder pattern

---

## Scope Overview

PR #1837 introduced optional `promptType` tracking. This plan makes it mandatory:
1. Interface changes: `options?: GenerateOptions` → `options: GenerateOptions`, `promptType?: string` → `promptType: string`
2. All infra client implementations updated to match signature
3. All ~50 production call sites updated to pass `{ promptType: <name> }`

---

## File Structure

### Interface Layer (packages)

| File                                           | Responsibility                                           |
| ---------------------------------------------- | -------------------------------------------------------- |
| `packages/llm-factory/src/llmClientFactory.ts` | Core interface: `LlmGenerateClient.generate()` signature |
| `packages/infra-openrouter/src/types.ts`       | OpenRouter GenerateOptions type                          |
| `packages/infra-gemini/src/client.ts`          | Gemini client implementation                             |
| `packages/infra-openrouter/src/client.ts`      | OpenRouter client implementation                         |
| `packages/infra-gpt/src/client.ts`             | GPT client implementation (add options)                  |
| `packages/infra-perplexity/src/client.ts`      | Perplexity client implementation (add options)           |
| `packages/infra-claude/src/client.ts`          | Claude client implementation (add options)               |

### Call Sites by Service (apps/workers)

| Service          | File(s)   | Count    |
| ---------------- | --------- | -------- |
| linear-agent     | 3 files   | 4 calls  |
| research-agent   | 7 files   | 16 calls |
| chat-agent       | 2 files   | 2 calls  |
| todos-agent      | 1 file    | 1 call   |
| calendar-agent   | 1 file    | 2 calls  |
| commands-agent   | 1 file    | 1 call   |
| hellscript-agent | 3 files   | 4 calls  |
| cron-agent       | 1 file    | 1 call   |
| web-agent        | 1 file    | 2 calls  |
| user-service     | 1 file    | 9 calls  |
| code-agent       | 3 files   | 5 calls  |
| orchestrator     | 2 files   | 5 calls  |
| internal-clients | 1 file    | 2 calls  |
| llm-prompts      | 1 file    | 1 call   |

---

## Task 1: Update Core Interface (llm-factory)

**Files:**
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Test: `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`

- [ ] **Step 1: Update GenerateOptions type - make promptType required**

```typescript
// packages/llm-factory/src/llmClientFactory.ts
// Change from:
export interface GenerateOptions {
  /** Semantic identifier for the prompt type (e.g., 'linear-issue-title', 'code-worker-validation') */
  promptType?: string;
}

// To:
export interface GenerateOptions {
  /** Semantic identifier for the prompt type (e.g., 'linear-issue-title', 'code-worker-validation') */
  promptType: string;
}
```

- [ ] **Step 2: Update LlmGenerateClient interface signature**

```typescript
// packages/llm-factory/src/llmClientFactory.ts
// Change from:
generate(prompt: string, options?: GenerateOptions): Promise<Result<GenerateResult, LLMError>>;

// To:
generate(prompt: string, options: GenerateOptions): Promise<Result<GenerateResult, LLMError>>;
```

- [ ] **Step 3: Run tests to see failures**

Run: `pnpm run verify:workspace:tracked -- llm-factory`
Expected: Tests fail due to signature mismatch with infra clients

- [ ] **Step 4: Update llmClientFactory test to pass required options**

```typescript
// packages/llm-factory/src/__tests__/llmClientFactory.test.ts
// Find test "should accept promptType in generate options"
// Update mock call to pass required promptType:
const result = await client.generate('test prompt', { promptType: 'test-prompt-type' });
```

- [ ] **Step 5: Commit interface changes**

```bash
git add packages/llm-factory/src/llmClientFactory.ts packages/llm-factory/src/__tests__/llmClientFactory.test.ts
git commit -m "[INT-1392] Make GenerateOptions.promptType required in LlmGenerateClient interface"
```

---

## Task 2: Update infra-openrouter GenerateOptions

**Files:**
- Modify: `packages/infra-openrouter/src/types.ts`
- Modify: `packages/infra-openrouter/src/client.ts`

- [ ] **Step 1: Update GenerateOptions in types.ts**

```typescript
// packages/infra-openrouter/src/types.ts
// Change from:
export interface GenerateOptions {
  /** Request a specific response format from the model (e.g., JSON mode). */
  responseFormat?: { type: 'json_object' | 'text' };
  /** Semantic identifier for what the prompt was used for */
  promptType?: string;
}

// To:
export interface GenerateOptions {
  /** Request a specific response format from the model (e.g., JSON mode). */
  responseFormat?: { type: 'json_object' | 'text' };
  /** Semantic identifier for what the prompt was used for */
  promptType: string;
}
```

- [ ] **Step 2: Update client.ts generate signature**

```typescript
// packages/infra-openrouter/src/client.ts
// Change generate method signature from:
generate: (
  prompt: string,
  options?: GenerateOptions
) => Promise<Result<GenerateResult, OpenRouterError>>;

// To:
generate: (
  prompt: string,
  options: GenerateOptions
) => Promise<Result<GenerateResult, OpenRouterError>>;
```

- [ ] **Step 3: Update trackUsage calls in generate method**

The `trackUsage` calls already pass `options?.promptType`. Update to `options.promptType` (no optional chain needed).

```typescript
// packages/infra-openrouter/src/client.ts line ~305-341
// Remove optional chaining: options?.promptType → options.promptType
trackUsage('generate', emptyUsage, false, errorMsg, undefined, options.promptType);
// and:
trackUsage('generate', normalized, true, undefined, providerReportedUsd, options.promptType);
```

- [ ] **Step 4: Commit infra-openrouter changes**

```bash
git add packages/infra-openrouter/src/types.ts packages/infra-openrouter/src/client.ts
git commit -m "[INT-1392] Make promptType required in OpenRouter GenerateOptions"
```

---

## Task 3: Update infra-gemini GenerateOptions

**Files:**
- Modify: `packages/infra-gemini/src/client.ts`

- [ ] **Step 1: Update GeminiClient interface in client.ts**

```typescript
// packages/infra-gemini/src/client.ts
// Change GeminiClient interface from:
export interface GeminiClient extends LLMClient {
  generate(
    prompt: string,
    options?: { promptType?: string }
  ): Promise<Result<GenerateResult, GeminiError>>;
}

// To:
export interface GeminiClient extends LLMClient {
  generate(
    prompt: string,
    options: { promptType: string }
  ): Promise<Result<GenerateResult, GeminiError>>;
}
```

- [ ] **Step 2: Update generate method implementation**

```typescript
// packages/infra-gemini/src/client.ts
// Change from:
async generate(
  prompt: string,
  options?: { promptType?: string }
): Promise<Result<GenerateResult, GeminiError>> {

// To:
async generate(
  prompt: string,
  options: { promptType: string }
): Promise<Result<GenerateResult, GeminiError>> {
```

- [ ] **Step 3: Update trackUsage calls - remove optional chaining**

```typescript
// packages/infra-gemini/src/client.ts
// Change from:
trackUsage('generate', usage, true, undefined, options?.promptType);
trackUsage('generate', emptyUsage, false, errorMsg, options?.promptType);

// To:
trackUsage('generate', usage, true, undefined, options.promptType);
trackUsage('generate', emptyUsage, false, errorMsg, options.promptType);
```

- [ ] **Step 4: Commit infra-gemini changes**

```bash
git add packages/infra-gemini/src/client.ts
git commit -m "[INT-1392] Make promptType required in GeminiClient.generate()"
```

---

## Task 4: Update infra-gpt client

**Files:**
- Modify: `packages/infra-gpt/src/client.ts`
- Test: `packages/infra-gpt/src/__tests__/client.test.ts`

- [ ] **Step 1: Add GenerateOptions type to client.ts**

```typescript
// packages/infra-gpt/src/client.ts
// Add after imports:
export interface GenerateOptions {
  /** Semantic identifier for what the prompt was used for */
  promptType: string;
}
```

- [ ] **Step 2: Update GptClient type signature**

```typescript
// packages/infra-gpt/src/client.ts
// Change from:
export type GptClient = LLMClient;

// To custom interface that extends LLMClient with required options:
export interface GptClient extends LLMClient {
  generate(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, GptError>>;
}
```

- [ ] **Step 3: Update generate method implementation**

```typescript
// packages/infra-gpt/src/client.ts
// Find async generate method (line ~174)
// Change from:
async generate(prompt: string): Promise<Result<GenerateResult, GptError>> {
  try {
    // ... existing code ...
    trackUsage('generate', usage, true);

// To:
async generate(prompt: string, options: GenerateOptions): Promise<Result<GenerateResult, GptError>> {
  try {
    // ... existing code ...
    trackUsage('generate', usage, true, undefined, options.promptType);
```

Also update trackUsage on error path:
```typescript
trackUsage('generate', emptyUsage, false, errorMsg, options.promptType);
```

- [ ] **Step 4: Update trackUsage function signature**

```typescript
// packages/infra-gpt/src/client.ts
// Add promptType parameter to trackUsage:
function trackUsage(
  callType: CallType,
  usage: NormalizedUsage,
  success: boolean,
  errorMessage?: string,
  promptType?: string
): void {
  void usageLogger.log({
    userId,
    provider: LlmProviders.OpenAI,
    model,
    callType,
    usage,
    success,
    ...(errorMessage !== undefined && { errorMessage }),
    ...(ownerType !== undefined && { ownerType }),
    ...(promptType !== undefined && { promptType }),
  });
}
```

- [ ] **Step 5: Update tests to pass promptType**

```typescript
// packages/infra-gpt/src/__tests__/client.test.ts
// Find all client.generate() calls and add promptType:
const result = await client.generate('Write something', { promptType: 'test-gpt-generation' });
```

- [ ] **Step 6: Commit infra-gpt changes**

```bash
git add packages/infra-gpt/src/client.ts packages/infra-gpt/src/__tests__/client.test.ts
git commit -m "[INT-1392] Add required promptType parameter to GptClient.generate()"
```

---

## Task 5: Update infra-perplexity client

**Files:**
- Modify: `packages/infra-perplexity/src/client.ts`
- Test: `packages/infra-perplexity/src/__tests__/client.test.ts`

- [ ] **Step 1: Add GenerateOptions type**

```typescript
// packages/infra-perplexity/src/client.ts
// Add after imports:
export interface GenerateOptions {
  /** Semantic identifier for what the prompt was used for */
  promptType: string;
}
```

- [ ] **Step 2: Update PerplexityClient type**

```typescript
// packages/infra-perplexity/src/client.ts
// Change from:
export type PerplexityClient = Pick<LLMClient, 'research' | 'generate'>;

// To:
export interface PerplexityClient extends Pick<LLMClient, 'research'> {
  generate(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, PerplexityError>>;
}
```

- [ ] **Step 3: Update generate method implementation**

```typescript
// packages/infra-perplexity/src/client.ts line ~297
// Change from:
async generate(prompt: string): Promise<Result<GenerateResult, PerplexityError>> {

// To:
async generate(prompt: string, options: GenerateOptions): Promise<Result<GenerateResult, PerplexityError>> {
```

Update trackUsage calls:
```typescript
trackUsage('generate', emptyUsage, false, errorMsg); // add promptType
trackUsage('generate', usage, true); // add promptType

// To:
trackUsage('generate', emptyUsage, false, errorMsg, options.promptType);
trackUsage('generate', usage, true, undefined, options.promptType);
```

- [ ] **Step 4: Update trackUsage signature**

Same pattern as infra-gpt - add promptType parameter.

- [ ] **Step 5: Update tests**

```typescript
// packages/infra-perplexity/src/__tests__/client.test.ts
// All generate calls:
const result = await client.generate('Write something', { promptType: 'test-perplexity-generation' });
```

- [ ] **Step 6: Commit**

```bash
git add packages/infra-perplexity/src/client.ts packages/infra-perplexity/src/__tests__/client.test.ts
git commit -m "[INT-1392] Add required promptType parameter to PerplexityClient.generate()"
```

---

## Task 6: Update infra-claude client

**Files:**
- Modify: `packages/infra-claude/src/client.ts`
- Test: `packages/infra-claude/src/__tests__/client.test.ts`

- [ ] **Step 1: Add GenerateOptions type**

```typescript
// packages/infra-claude/src/client.ts
export interface GenerateOptions {
  /** Semantic identifier for what the prompt was used for */
  promptType: string;
}
```

- [ ] **Step 2: Update ClaudeClient type**

```typescript
// Change from:
export type ClaudeClient = LLMClient;

// To:
export interface ClaudeClient extends LLMClient {
  generate(
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<GenerateResult, ClaudeError>>;
}
```

- [ ] **Step 3: Update generate method (line ~157)**

Add options parameter and pass promptType to trackUsage.

- [ ] **Step 4: Update trackUsage signature**

Add promptType parameter, spread conditionally.

- [ ] **Step 5: Update tests**

All generate calls pass `{ promptType: 'test-claude-generation' }`.

- [ ] **Step 6: Commit**

```bash
git add packages/infra-claude/src/client.ts packages/infra-claude/src/__tests__/client.test.ts
git commit -m "[INT-1392] Add required promptType parameter to ClaudeClient.generate()"
```

---

## Task 7: Build packages after interface changes

**Files:**
- No file changes - verification step

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully with new interface

- [ ] **Step 2: Run package tests**

Run: `pnpm run verify:workspace:tracked -- llm-factory && pnpm run verify:workspace:tracked -- infra-gemini && pnpm run verify:workspace:tracked -- infra-openrouter`
Expected: All pass

- [ ] **Step 3: If failures, fix type mismatches**

Check error messages, update any missed signature changes.

---

## Task 8: Update linear-agent call sites

**Files:**
- Modify: `apps/linear-agent/src/domain/useCases/generateIssueTitle.ts`
- Modify: `apps/linear-agent/src/infra/llm/linearActionExtractionService.ts`
- Modify: `apps/linear-agent/src/infra/llm/issuePruningClassifier.ts`
- Modify: `apps/linear-agent/src/services.ts`
- Test: Update corresponding test files

- [ ] **Step 1: generateIssueTitle.ts - already updated in PR #1837**

Verify: `llmClient.generate(prompt, { promptType: linearIssueTitlePrompt.name })`

- [ ] **Step 2: linearActionExtractionService.ts - already updated in PR #1837**

Verify: `llmClient.generate(prompt, { promptType: linearActionExtractionPrompt.name })`

- [ ] **Step 3: Update issuePruningClassifier.ts**

The classifier uses a wrapped `generate` function. Update deps interface:

```typescript
// apps/linear-agent/src/infra/llm/issuePruningClassifier.ts
// Change ClassifierDeps.generate signature:
interface ClassifierDeps {
  generate: (prompt: string, options: { promptType: string }) => Promise<Result<GeminiGenerateResult, GeminiGenerateError>>;
  logger: Logger;
}
```

Update call site:
```typescript
// Line 115:
const result = await deps.generate(prompt, { promptType: 'linear-issue-pruning-classification' });
```

- [ ] **Step 4: Update services.ts wrapper**

```typescript
// apps/linear-agent/src/services.ts line 93
// Change from:
createClassifier: (llmClient: LlmGenerateClient): IssuePruningClassifier =>
  createIssuePruningClassifier({ generate: (prompt) => llmClient.generate(prompt), logger }),

// To:
createClassifier: (llmClient: LlmGenerateClient): IssuePruningClassifier =>
  createIssuePruningClassifier({ generate: (prompt, options) => llmClient.generate(prompt, options), logger }),
```

- [ ] **Step 5: Update tests**

```typescript
// apps/linear-agent/src/__tests__/infra/issuePruningClassifier.test.ts (if exists)
// Update mock generate calls to pass promptType
mockGenerate.mockResolvedValueOnce({
  ok: true,
  value: { content: '...', usage: {...} },
});
// Call with options:
const result = await classifier.classifyCandidates(issues, 5, logger);
// Verify mock was called with promptType
expect(mockGenerate).toHaveBeenCalledWith(expect.anything(), { promptType: 'linear-issue-pruning-classification' });
```

- [ ] **Step 6: Commit**

```bash
git add apps/linear-agent/src/infra/llm/issuePruningClassifier.ts apps/linear-agent/src/services.ts apps/linear-agent/src/__tests__/
git commit -m "[INT-1392] Update linear-agent to pass required promptType"
```

---

## Task 9: Update research-agent adapters

**Files:**
- Modify: `apps/research-agent/src/infra/llm/GeminiAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/GptAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/InputValidationAdapter.ts`
- Modify: `apps/research-agent/src/infra/llm/ContextInferenceAdapter.ts`
- Modify: `apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts`

- [ ] **Step 1: GeminiAdapter.ts - 3 generate calls**

```typescript
// apps/research-agent/src/infra/llm/GeminiAdapter.ts

// Line 85 - synthesize:
const result = await this.client.generate(synthesisPrompt, { promptType: 'research-synthesis' });

// Line 116 - generateTitle:
const result = await this.client.generate(builtPrompt, { promptType: titlePrompt.name });

// Line 144 - generateContextLabel:
const result = await this.client.generate(builtPrompt, { promptType: labelPrompt.name });
```

- [ ] **Step 2: OpenRouterAdapter.ts - 2 generate calls**

```typescript
// apps/research-agent/src/infra/llm/OpenRouterAdapter.ts

// Line 84 - synthesize:
const result = await this.client.generate(synthesisPrompt, { promptType: 'research-synthesis' });

// Line 115:
const result = await this.client.generate(builtPrompt, { promptType: 'research-context-build' });
```

- [ ] **Step 3: GptAdapter.ts - 2 generate calls**

```typescript
// apps/research-agent/src/infra/llm/GptAdapter.ts

// Line 77:
const result = await this.client.generate(synthesisPrompt, { promptType: 'research-synthesis' });

// Line 108:
const result = await this.client.generate(builtPrompt, { promptType: 'research-context-build' });
```

- [ ] **Step 4: InputValidationAdapter.ts - 4 generate calls**

```typescript
// apps/research-agent/src/infra/llm/InputValidationAdapter.ts

// Line 64:
const result = await this.client.generate(builtPrompt, { promptType: 'research-input-validation' });

// Line 102:
const result = await this.client.generate(builtPrompt, { promptType: 'research-input-improvement' });

// Line 153:
const result = await this.client.generate(repairPrompt, { promptType: 'research-input-validation-repair' });

// Line 221:
const result = await this.client.generate(repairPrompt, { promptType: 'research-input-improvement-repair' });
```

- [ ] **Step 5: ContextInferenceAdapter.ts - 4 generate calls**

```typescript
// apps/research-agent/src/infra/llm/ContextInferenceAdapter.ts

// Line 96, 157, 224, 272:
const result = await this.client.generate(prompt, { promptType: 'research-context-inference' });
const result = await this.client.generate(prompt, { promptType: 'research-context-inference' });
const result = await this.client.generate(repairPrompt, { promptType: 'research-context-inference-repair' });
const result = await this.client.generate(repairPrompt, { promptType: 'research-context-inference-repair' });
```

- [ ] **Step 6: extractModelPreferences.ts**

```typescript
// apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts line 228:
const result = await llmClient.generate(prompt, { promptType: 'research-model-preference-extraction' });
```

- [ ] **Step 7: Commit**

```bash
git add apps/research-agent/src/infra/llm/*.ts apps/research-agent/src/domain/research/usecases/extractModelPreferences.ts
git commit -m "[INT-1392] Update research-agent adapters to pass required promptType"
```

---

## Task 10: Update chat-agent

**Files:**
- Modify: `apps/chat-agent/src/infra/llm/chatClient.ts`
- Modify: `apps/chat-agent/src/domain/usecases/generateResponse.ts`

Note: chat-agent uses a custom LLMClient interface with different options structure (systemPrompt, conversationHistory). This needs careful handling.

- [ ] **Step 1: Update chatClient.ts local LLMClient interface**

```typescript
// apps/chat-agent/src/infra/llm/chatClient.ts
// The local chatClient wraps an external LlmGenerateClient
// Find generate call (line ~59):
const result = await llmClient.generate(fullPrompt, { promptType: 'chat-response-generation' });
```

- [ ] **Step 2: Update generateResponse.ts**

```typescript
// apps/chat-agent/src/domain/usecases/generateResponse.ts

// This file has a LOCAL LLMClient interface (lines 60-68) that's different:
export interface LLMClient {
  generate(
    prompt: string,
    options?: {
      systemPrompt?: string;
      conversationHistory?: ConversationHistory[];
    }
  ): Promise<Result<LLMResponse, LLMError>>;
}

// This is NOT the same as LlmGenerateClient - it's a different interface
// The chatClient.ts implements this by wrapping the actual LlmGenerateClient
// Leave this interface unchanged - it's an internal abstraction
// Update chatClient.ts implementation to pass promptType to the wrapped client
```

- [ ] **Step 3: Commit**

```bash
git add apps/chat-agent/src/infra/llm/chatClient.ts
git commit -m "[INT-1392] Update chat-agent to pass promptType to underlying LlmGenerateClient"
```

---

## Task 11: Update todos-agent

**Files:**
- Modify: `apps/todos-agent/src/infra/gemini/todoItemExtractionService.ts`

- [ ] **Step 1: Update generate call**

```typescript
// apps/todos-agent/src/infra/gemini/todoItemExtractionService.ts line 79:
const result = await llmClient.generate(prompt, { promptType: 'todo-item-extraction' });
```

- [ ] **Step 2: Import itemExtractionPrompt if not already**

```typescript
// If prompt is built with itemExtractionPrompt, use its name:
import { itemExtractionPrompt } from '@intexuraos/llm-prompts';
// Then:
const result = await llmClient.generate(prompt, { promptType: itemExtractionPrompt.name });
```

- [ ] **Step 3: Commit**

```bash
git add apps/todos-agent/src/infra/gemini/todoItemExtractionService.ts
git commit -m "[INT-1392] Update todos-agent to pass required promptType"
```

---

## Task 12: Update calendar-agent

**Files:**
- Modify: `apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts`

- [ ] **Step 1: Update 2 generate calls**

```typescript
// apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts

// Line 146:
const result = await llmClient.generate(prompt, { promptType: calendarActionExtractionPrompt.name });

// Line 217 (repair):
const repairResult = await llmClient.generate(repairPrompt, { promptType: 'calendar-action-extraction-repair' });
```

- [ ] **Step 2: Import calendarActionExtractionPrompt**

```typescript
import { calendarActionExtractionPrompt } from '@intexuraos/llm-prompts';
```

- [ ] **Step 3: Commit**

```bash
git add apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts
git commit -m "[INT-1392] Update calendar-agent to pass required promptType"
```

---

## Task 13: Update commands-agent

**Files:**
- Modify: `apps/commands-agent/src/infra/llm/classifier.ts`

- [ ] **Step 1: Update generate call**

```typescript
// apps/commands-agent/src/infra/llm/classifier.ts line 19:
const result = await client.generate(prompt, { promptType: 'command-classification' });
```

Or use `commandClassifierPrompt.name` if imported.

- [ ] **Step 2: Commit**

```bash
git add apps/commands-agent/src/infra/llm/classifier.ts
git commit -m "[INT-1392] Update commands-agent to pass required promptType"
```

---

## Task 14: Update hellscript-agent

**Files:**
- Modify: `apps/hellscript-agent/src/infra/llm/geminiDraftGenerator.ts`
- Modify: `apps/hellscript-agent/src/infra/llm/geminiIntentInterpreter.ts`
- Modify: `apps/hellscript-agent/src/domain/usecases/imposeOnBuffer.ts`

- [ ] **Step 1: geminiDraftGenerator.ts**

```typescript
// apps/hellscript-agent/src/infra/llm/geminiDraftGenerator.ts line 33:
const result = await this.client.generate(prompt, { promptType: 'hellscript-draft-generation' });
```

- [ ] **Step 2: geminiIntentInterpreter.ts**

```typescript
// apps/hellscript-agent/src/infra/llm/geminiIntentInterpreter.ts line 30:
const result = await this.client.generate(prompt, { promptType: 'hellscript-intent-interpretation' });
```

- [ ] **Step 3: imposeOnBuffer.ts**

```typescript
// apps/hellscript-agent/src/domain/usecases/imposeOnBuffer.ts line 151:
const generateResult = await draftGenerator.generate(
  prompt,
  { promptType: 'hellscript-draft-generation' }
);
```

- [ ] **Step 4: Commit**

```bash
git add apps/hellscript-agent/src/infra/llm/*.ts apps/hellscript-agent/src/domain/usecases/imposeOnBuffer.ts
git commit -m "[INT-1392] Update hellscript-agent to pass required promptType"
```

---

## Task 15: Update cron-agent

**Files:**
- Modify: `apps/cron-agent/src/domain/use-cases/parse-schedule.ts`

- [ ] **Step 1: Update generate call**

```typescript
// apps/cron-agent/src/domain/use-cases/parse-schedule.ts line 30:
const result = await geminiClient.generate(prompt, { promptType: 'cron-schedule-parsing' });
```

- [ ] **Step 2: Commit**

```bash
git add apps/cron-agent/src/domain/use-cases/parse-schedule.ts
git commit -m "[INT-1392] Update cron-agent to pass required promptType"
```

---

## Task 16: Update web-agent

**Files:**
- Modify: `apps/web-agent/src/infra/pagesummary/llmSummarizer.ts`

- [ ] **Step 1: Update 2 generate calls**

```typescript
// apps/web-agent/src/infra/pagesummary/llmSummarizer.ts

// Line 80 (repair):
const repairResult = await llmClient.generate(repairPrompt, { promptType: 'web-summary-repair' });

// Line 156:
const result = await llmClient.generate(fullPrompt, { promptType: 'web-page-summary' });
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-agent/src/infra/pagesummary/llmSummarizer.ts
git commit -m "[INT-1392] Update web-agent to pass required promptType"
```

---

## Task 17: Update user-service LlmValidatorImpl

**Files:**
- Modify: `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`

- [ ] **Step 1: Define prompt type constant**

```typescript
// apps/user-service/src/infra/llm/LlmValidatorImpl.ts
const VALIDATION_PROMPT_TYPE = 'user-service-validation';
```

- [ ] **Step 2: Update all 9 generate calls**

```typescript
// Lines 57, 77, 97, 117, 168, 185, 202, 219, 236:
const result = await client.generate(VALIDATION_PROMPT, { promptType: VALIDATION_PROMPT_TYPE });
const result = await client.generate(prompt, { promptType: VALIDATION_PROMPT_TYPE });
```

- [ ] **Step 3: Commit**

```bash
git add apps/user-service/src/infra/llm/LlmValidatorImpl.ts
git commit -m "[INT-1392] Update user-service LlmValidatorImpl to pass required promptType"
```

---

## Task 18: Update code-agent

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`
- Modify: `apps/code-agent/src/domain/usecases/triageFailedTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`

- [ ] **Step 1: processExecutionMemoryBacklog.ts - 4 calls**

```typescript
// apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts

// Line 457:
const evaluationResult = await deps.evaluatorClient.generate(evaluationPrompt, { promptType: 'execution-memory-evaluation' });

// Line 476:
const retryResult = await deps.evaluatorClient.generate(refinementPrompt, { promptType: 'execution-memory-evaluation-retry' });

// Line 753:
const result = await deps.distillerClient.generate(prompt, { promptType: 'execution-memory-distillation' });

// Line 771:
const retryResult = await deps.distillerClient.generate(refinementPrompt, { promptType: 'execution-memory-distillation-retry' });
```

- [ ] **Step 2: triageFailedTask.ts**

```typescript
// apps/code-agent/src/domain/usecases/triageFailedTask.ts line 127:
const generateResult = await llmClientResult.value.generate(prompt, { promptType: 'failed-task-triage' });
```

- [ ] **Step 3: prepareExecutionMemoryContext.ts**

```typescript
// apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts line 334:
const generationResult = await params.queryClient.generate(normalizationPrompt, { promptType: 'execution-memory-context-normalization' });
```

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/*.ts
git commit -m "[INT-1392] Update code-agent to pass required promptType"
```

---

## Task 19: Update orchestrator worker

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`
- Modify: `workers/orchestrator/src/services/agent-compliance-validator.ts`

- [ ] **Step 1: completion-verifier.ts - 3 generate calls**

```typescript
// workers/orchestrator/src/services/completion-verifier.ts

// Line 648:
const result = await client.generate(prompt, { promptType: `completion-verification-${input.agentType}` });

// Line 883:
const result = await this.primaryClient.generate(prompt, { promptType: 'resume-summary-extraction' });

// Line 899:
const fallbackResult = await fallback.client.generate(prompt, { promptType: 'resume-summary-extraction' });
```

- [ ] **Step 2: agent-compliance-validator.ts**

```typescript
// workers/orchestrator/src/services/agent-compliance-validator.ts line 463:
const result = await entry.client.generate(prompt, { promptType: 'agent-compliance-validation' });
```

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/agent-compliance-validator.ts
git commit -m "[INT-1392] Update orchestrator to pass required promptType"
```

---

## Task 20: Update internal-clients package

**Files:**
- Modify: `packages/internal-clients/src/user-service/client.ts`

- [ ] **Step 1: Update 2 generate calls**

```typescript
// packages/internal-clients/src/user-service/client.ts

// Line 267:
const primaryResult = await primaryClient.generate(prompt, { promptType: 'user-service-fallback-validation' });

// Line 289:
const fallbackResult = await fallbackClient.generate(prompt, { promptType: 'user-service-fallback-validation' });
```

- [ ] **Step 2: Commit**

```bash
git add packages/internal-clients/src/user-service/client.ts
git commit -m "[INT-1392] Update internal-clients to pass required promptType"
```

---

## Task 21: Update llm-prompts package

**Files:**
- Modify: `packages/llm-prompts/src/image/generateThumbnailPrompt.ts`

- [ ] **Step 1: Update generate call**

```typescript
// packages/llm-prompts/src/image/generateThumbnailPrompt.ts line 129:
const generateResult = await client.generate(fullPrompt, { promptType: 'thumbnail-generation' });
```

- [ ] **Step 2: Commit**

```bash
git add packages/llm-prompts/src/image/generateThumbnailPrompt.ts
git commit -m "[INT-1392] Update llm-prompts to pass required promptType"
```

---

## Task 22: Update all test files

**Files:**
- All test files that call `.generate()` need updates

This is a batch task - find all test generate calls and add promptType.

- [ ] **Step 1: Find all test generate calls without promptType**

Run: `rg "\.generate\('[^']+'\)" packages/*/src/__tests__ apps/*/src/__tests__ workers/*/src/__tests__ --files-with-matches`

- [ ] **Step 2: Update each test file**

Pattern: All `client.generate('test prompt')` → `client.generate('test prompt', { promptType: 'test-prompt' })`

Use `test-prompt` or a descriptive name for test prompt types.

- [ ] **Step 3: Run tests to verify**

Run: `pnpm run ci:tracked`
Expected: All tests pass with updated signatures

---

## Task 23: Final verification and commit

**Files:**
- No additional files

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All 14000+ tests pass

- [ ] **Step 2: Check TypeScript compilation**

Run: `pnpm build`
Expected: No type errors

- [ ] **Step 3: Verify promptType appears in usage events**

Run local test to verify promptType is tracked in usage events.

- [ ] **Step 4: Create PR**

```bash
gh pr create --title "[INT-1392] Make promptType required for all LLM generate calls" --body "..."
```

---

## Prompt Type Reference

| Prompt                      | Type String                           | Source                                |
| --------------------------- | ------------------------------------- | ------------------------------------- |
| Linear issue title          | `linear-issue-title`                  | `linearIssueTitlePrompt.name`         |
| Linear action extraction    | `linear-action-extraction`            | `linearActionExtractionPrompt.name`   |
| Calendar action extraction  | `calendar-action-extraction`          | `calendarActionExtractionPrompt.name` |
| Todo item extraction        | `todo-item-extraction`                | `itemExtractionPrompt.name`           |
| Command classification      | `command-classification`              | `commandClassifierPrompt.name`        |
| Title generation            | `title-generation`                    | `titlePrompt.name`                    |
| Label generation            | `label-generation`                    | `labelPrompt.name`                    |
| Thumbnail generation        | `thumbnail-generation`                | `thumbnailPrompt.name`                |
| Issue pruning               | `linear-issue-pruning-classification` | inline                                |
| Research synthesis          | `research-synthesis`                  | inline                                |
| Execution memory evaluation | `execution-memory-evaluation`         | inline                                |
| Completion verification     | `completion-verification-{agentType}` | inline                                |

---

## Self-Review Checklist

**1. Spec coverage:**
- Interface signature change (options required) ✓ Task 1
- promptType required in GenerateOptions ✓ Task 1, 2, 3
- All infra clients updated ✓ Tasks 2-6
- All app/worker call sites updated ✓ Tasks 8-21

**2. Placeholder scan:**
- No TBD, TODO, or vague instructions ✓
- All code changes shown explicitly ✓

**3. Type consistency:**
- GenerateOptions.promptType: string ✓
- All generate() signatures: `generate(prompt: string, options: GenerateOptions)` ✓

---

## Endpoint Changes

| Endpoint   | Status                                                         |
| ---------- | -------------------------------------------------------------- |
| None       | This is a library/interface change, no HTTP endpoints affected |

---

## Decision Log

| Decision                                               | Reason                                       |
| ------------------------------------------------------ | -------------------------------------------- |
| Use PromptBuilder.name where available                 | Canonical source, versioned, already defined |
| Inline prompt type strings for non-PromptBuilder calls | No PromptBuilder exists for these prompts    |
| `test-prompt` for test prompt types                    | Simple, consistent across all test files     |