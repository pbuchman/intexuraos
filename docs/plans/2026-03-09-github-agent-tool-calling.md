# GitHub Agent with Tool Calling — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an LLM-powered GitHub Agent in code-agent that receives GitHub webhook events, analyzes them using native Gemini function calling, and dispatches review actions to the orchestrator.

**Architecture:** Three-layer agent hierarchy — (1) GitHub Agent in code-agent makes fast LLM decisions with tool calling, (2) Review Agent in orchestrator coordinates review scope, (3) Review Subagents post structured findings on PRs. Tool calling infrastructure lives in shared packages (llm-contract types, infra-gemini implementation, llm-factory routing).

**Tech Stack:** TypeScript, Gemini 3 Flash (`@google/genai` native function calling), Fastify, Vitest, Result pattern

**Linear Issue:** [INT-743](https://linear.app/pbuchman/issue/INT-743)

---

## Subtask Boundaries & Contracts

This plan splits into **3 parallel subtasks**, each owning a distinct service boundary. All subtasks can be executed independently by separate agents.

### Shared Contract: `ToolCallingClient` Interface

All subtasks agree on these exact types (defined in Subtask 1, consumed by Subtask 2):

```typescript
// packages/llm-contract/src/toolCalling.ts
export interface ToolCallingMessage {
  role: 'user' | 'model';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface ToolCallingClient {
  run(params: {
    systemPrompt: string;
    messages: ToolCallingMessage[];
    tools: ToolDefinition[];
    maxIterations?: number;
  }): Promise<Result<ToolCallingResult, LLMError>>;
}

export interface ToolCallingResult {
  content: string;
  toolCallsMade: number;
  usage: NormalizedUsage;
}

export type ToolCallingModel = 'gemini-3-flash';
```

### Shared Contract: `'review'` Agent Type

Subtask 2 dispatches tasks with `agentType: 'review'`. Subtask 3 handles them with a dedicated system prompt and completion verifier.

```typescript
// Subtask 2 produces (in dispatch request):
{ agentType: 'review', reviewType: 'frontend', prNumber: 123, repository: 'owner/repo' }

// Subtask 3 consumes (in orchestrator):
// - AgentType union includes 'review'
// - buildSystemPrompt() handles agentType === 'review'
// - CompletionVerifier handles 'review' with REVIEW_AGENT_FINAL schema
```

### Shared Contract: `UserServiceClient.getToolCallingClient()`

```typescript
// packages/internal-clients/src/user-service/types.ts
export interface UserServiceClient {
  // ... existing methods ...
  getToolCallingClient(userId: string): Promise<Result<ToolCallingClient, UserServiceError>>;
}
```

---

## Subtask 1: Tool Calling Infrastructure (packages)

**Owner:** packages/llm-contract, packages/infra-gemini, packages/llm-factory, packages/internal-clients

**Responsibility:** Define tool calling types, implement Gemini function calling loop, add factory routing, extend user service client.

### Task 1.1: Tool Calling Types in llm-contract

**Files:**
- Create: `packages/llm-contract/src/toolCalling.ts`
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Test: `packages/llm-contract/src/__tests__/supportedModels.test.ts`

**Step 1: Write the failing test for ToolCallingModel**

Add to `packages/llm-contract/src/__tests__/supportedModels.test.ts`:

```typescript
describe('ToolCallingModel', () => {
  it('should include gemini-3-flash', () => {
    const model: ToolCallingModel = 'gemini-3-flash';
    expect(model).toBe('gemini-3-flash');
  });

  it('should have TOOL_CALLING_MODEL_PRICING', () => {
    expect(TOOL_CALLING_MODEL_PRICING['gemini-3-flash']).toEqual({
      inputPricePerMillion: 0.5,
      outputPricePerMillion: 2.0,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter @intexuraos/llm-contract test`
Expected: FAIL — `ToolCallingModel` and `TOOL_CALLING_MODEL_PRICING` not found

**Step 3: Create toolCalling.ts with type definitions**

Create `packages/llm-contract/src/toolCalling.ts`:

```typescript
import type { LLMError, NormalizedUsage } from './types.js';
import type { ModelPricing } from './pricing.js';

export interface ToolCallingMessage {
  role: 'user' | 'model';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface ToolCallingClient {
  run(params: {
    systemPrompt: string;
    messages: ToolCallingMessage[];
    tools: ToolDefinition[];
    maxIterations?: number;
  }): Promise<Result<ToolCallingResult, LLMError>>;
}

export interface ToolCallingResult {
  content: string;
  toolCallsMade: number;
  usage: NormalizedUsage;
}

export type ToolCallingModel = 'gemini-3-flash';

export interface ToolCallingClientConfig {
  apiKey: string;
  model: ToolCallingModel;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
}
```

Note: Import `Result` from `@intexuraos/common-core` and `Logger` from the logger package, matching existing patterns in `types.ts`.

**Step 4: Add ToolCallingModel to supportedModels.ts**

Add to `packages/llm-contract/src/supportedModels.ts`:

```typescript
export type ToolCallingModel = 'gemini-3-flash';

export const TOOL_CALLING_MODEL_PRICING: Record<ToolCallingModel, ModelPricing> = {
  'gemini-3-flash': {
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 2.0,
  },
};
```

**Step 5: Export from index.ts**

Add to `packages/llm-contract/src/index.ts`:

```typescript
export type { ToolCallingMessage, ToolDefinition, ToolCallingClient, ToolCallingResult, ToolCallingClientConfig } from './toolCalling.js';
export { type ToolCallingModel, TOOL_CALLING_MODEL_PRICING } from './supportedModels.js';
```

**Step 6: Run test to verify it passes**

Run: `cd /repo && pnpm --filter @intexuraos/llm-contract test`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/llm-contract/src/toolCalling.ts packages/llm-contract/src/supportedModels.ts packages/llm-contract/src/index.ts packages/llm-contract/src/__tests__/supportedModels.test.ts
git commit -m "feat(llm-contract): add tool calling types and ToolCallingModel"
```

---

### Task 1.2: Gemini Tool Calling Client in infra-gemini

**Files:**
- Create: `packages/infra-gemini/src/toolCallingClient.ts`
- Modify: `packages/infra-gemini/src/index.ts`
- Test: `packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`

**Step 1: Write failing tests for the Gemini tool calling loop**

Create `packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test scenarios (all mock @google/genai):
// 1. "returns content when Gemini responds with text (no function call)"
//    - Mock generateContent → returns { text: 'No review needed' }
//    - Expect: { content: 'No review needed', toolCallsMade: 0, usage: {...} }

// 2. "calls tool run callback when Gemini returns functionCall"
//    - Mock generateContent → first call returns functionCall part
//    - Mock generateContent → second call returns text
//    - Expect: tool.run called with correct args
//    - Expect: { content: 'Done', toolCallsMade: 1, usage: {...} }

// 3. "stops at maxIterations even if Gemini keeps calling tools"
//    - Mock generateContent → always returns functionCall
//    - Set maxIterations: 2
//    - Expect: tool.run called exactly 2 times
//    - Expect: result.ok === true, toolCallsMade: 2

// 4. "returns LLMError when tool run callback throws"
//    - Mock tool.run → throws Error('dispatch failed')
//    - Expect: result.ok === false, error.code === 'API_ERROR'

// 5. "aggregates usage across multiple iterations"
//    - Mock generateContent → 2 iterations (functionCall then text)
//    - First response: promptTokenCount: 100, candidatesTokenCount: 50
//    - Second response: promptTokenCount: 150, candidatesTokenCount: 30
//    - Expect: usage.inputTokens: 250, usage.outputTokens: 80

// 6. "converts ToolDefinition[] to Gemini functionDeclarations format"
//    - Verify the Gemini API is called with correct tools config structure

// 7. "handles empty text response gracefully"
//    - Mock generateContent → returns { text: undefined }
//    - Expect: content === ''

// 8. "maps Gemini API errors to LLMError codes"
//    - Mock generateContent → throws with 429 status
//    - Expect: error.code === 'RATE_LIMITED'
```

**Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter @intexuraos/infra-gemini test`
Expected: FAIL — `toolCallingClient` module not found

**Step 3: Implement the Gemini tool calling client**

Create `packages/infra-gemini/src/toolCallingClient.ts`:

Key implementation details:
- Import `GoogleGenAI` from `@google/genai`
- Export `createGeminiToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient`
- Convert `ToolDefinition[]` → Gemini `functionDeclarations` format:
  ```typescript
  const functionDeclarations = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  ```
- Build conversation as `Content[]` array for multi-turn
- Loop: call `ai.models.generateContent()`, check for `functionCall` parts
- If `functionCall`: find matching tool by name, call `tool.run(args)`, append `functionResponse` to conversation
- If no `functionCall` or `maxIterations` reached: break, return text + aggregated usage
- Use `mapGeminiError()` from existing `client.ts` for error handling (or duplicate the pattern)
- Aggregate `promptTokenCount` and `candidatesTokenCount` across all iterations
- Calculate cost using `normalizeUsage()` from `costCalculator.ts`
- Default `maxIterations` to 5

**Step 4: Export from index.ts**

Add to `packages/infra-gemini/src/index.ts`:

```typescript
export { createGeminiToolCallingClient } from './toolCallingClient.js';
```

**Step 5: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter @intexuraos/infra-gemini test`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/infra-gemini/src/toolCallingClient.ts packages/infra-gemini/src/__tests__/toolCallingClient.test.ts packages/infra-gemini/src/index.ts
git commit -m "feat(infra-gemini): implement Gemini tool calling client with function calling loop"
```

---

### Task 1.3: Factory Routing in llm-factory

**Files:**
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/index.ts`
- Test: `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`

**Step 1: Write failing test for createToolCallingClient**

Add to `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`:

```typescript
describe('createToolCallingClient', () => {
  it('should route gemini-3-flash to Gemini tool calling client', () => {
    const client = createToolCallingClient({
      apiKey: 'test-key',
      model: 'gemini-3-flash',
      userId: 'user-1',
      pricing: mockPricing,
      logger: mockLogger,
    });
    expect(client).toBeDefined();
    expect(client.run).toBeTypeOf('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter @intexuraos/llm-factory test`
Expected: FAIL — `createToolCallingClient` not found

**Step 3: Add createToolCallingClient to factory**

Add to `packages/llm-factory/src/llmClientFactory.ts`:

```typescript
import { createGeminiToolCallingClient } from '@intexuraos/infra-gemini';
import type { ToolCallingClient, ToolCallingClientConfig } from '@intexuraos/llm-contract';

export function createToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient {
  // For MVP: only Gemini provider supported for tool calling
  return createGeminiToolCallingClient(config);
}
```

**Step 4: Export from index.ts**

```typescript
export { createToolCallingClient } from './llmClientFactory.js';
```

**Step 5: Run test to verify it passes**

Run: `cd /repo && pnpm --filter @intexuraos/llm-factory test`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/llm-factory/src/llmClientFactory.ts packages/llm-factory/src/index.ts packages/llm-factory/src/__tests__/llmClientFactory.test.ts
git commit -m "feat(llm-factory): add createToolCallingClient factory routing"
```

---

### Task 1.4: User Service Client Extension

**Files:**
- Modify: `packages/internal-clients/src/user-service/types.ts`
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Test: `packages/internal-clients/src/user-service/__tests__/client.test.ts`

**Step 1: Write failing test for getToolCallingClient**

Add to `packages/internal-clients/src/user-service/__tests__/client.test.ts`:

```typescript
describe('getToolCallingClient', () => {
  it('should return a ToolCallingClient using platform Gemini key', async () => {
    // Mock: GET /internal/users/{userId}/settings → { defaultModel: null }
    // Mock: platformGeminiApiKey is set
    // Expect: Returns ok result with ToolCallingClient
    // Expect: client.run is a function
  });

  it('should return error when no platform Gemini key configured', async () => {
    // Mock: platformGeminiApiKey is undefined
    // Expect: Returns err with NO_API_KEY code
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter @intexuraos/internal-clients test`
Expected: FAIL — `getToolCallingClient` not found on client

**Step 3: Add getToolCallingClient to types and client**

In `packages/internal-clients/src/user-service/types.ts`, add to `UserServiceClient`:

```typescript
getToolCallingClient(userId: string): Promise<Result<ToolCallingClient, UserServiceError>>;
```

In `packages/internal-clients/src/user-service/client.ts`, implement:

```typescript
async getToolCallingClient(userId: string): Promise<Result<ToolCallingClient, UserServiceError>> {
  // For MVP: always use platform Gemini key with gemini-3-flash
  if (!config.platformGeminiApiKey) {
    return err({ code: 'NO_API_KEY', message: 'Platform Gemini API key not configured for tool calling' });
  }

  const client = createToolCallingClient({
    apiKey: config.platformGeminiApiKey,
    model: 'gemini-3-flash',
    userId,
    pricing: TOOL_CALLING_MODEL_PRICING['gemini-3-flash'],
    logger: config.logger,
  });

  return ok(client);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm --filter @intexuraos/internal-clients test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/internal-clients/src/user-service/types.ts packages/internal-clients/src/user-service/client.ts packages/internal-clients/src/user-service/__tests__/client.test.ts
git commit -m "feat(internal-clients): add getToolCallingClient to UserServiceClient"
```

---

## Subtask 2: GitHub Agent Use Case (apps/code-agent)

**Owner:** apps/code-agent

**Responsibility:** Create the GitHub Agent use case that receives PR events, calls the tool calling client, and dispatches review tasks.

**Dependencies (by contract only — no code dependency on other subtasks being complete):**
- `ToolCallingClient` interface from `@intexuraos/llm-contract` (defined in Subtask 1 contract above)
- `UserServiceClient.getToolCallingClient()` from `@intexuraos/internal-clients` (defined in Subtask 1 contract above)
- Tests mock all external interfaces using the contracts defined above

### Task 2.1: GitHub Agent Prompt

**Files:**
- Create: `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`
- Test: `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`

**Step 1: Write test for prompt builder**

```typescript
describe('githubAgentPrompt', () => {
  it('should include instruction to analyze PR changes', () => {
    const prompt = buildGitHubAgentSystemPrompt();
    expect(prompt).toContain('pull request');
    expect(prompt).toContain('request_review');
  });

  it('should have correct version', () => {
    expect(githubAgentPrompt.version).toBe('1.0.0');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter code-agent test -- --testPathPattern githubAgentPrompt`
Expected: FAIL

**Step 3: Implement the prompt**

Create `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`:

```typescript
import type { PromptBuilder } from './types.js';

export const githubAgentPrompt: PromptBuilder = {
  name: 'github-agent',
  description: 'System prompt for GitHub Agent LLM that analyzes PR events and dispatches reviews',
  version: '1.0.0',
  build: () => `You are a GitHub Agent that analyzes pull request events and decides whether to dispatch code reviews.

You receive a pull request event with a diff summary. Your job:
1. Analyze which files are changed in the PR
2. Determine if the changes warrant a code review
3. If changes touch apps/web/ (frontend), call request_review with review_type "frontend"
4. If no review is needed, respond with a brief explanation why

Rules:
- Only dispatch reviews for substantive code changes (not just config/docs)
- For MVP, only frontend reviews are supported (apps/web/ changes)
- Be concise in your reasoning
- Always call the tool if the PR touches apps/web/ source files`,
};
```

**Step 4: Run test, verify pass, commit**

---

### Task 2.2: GitHub Agent Use Case

**Files:**
- Create: `apps/code-agent/src/domain/usecases/githubAgent.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/githubAgent.test.ts`

**Step 1: Write failing tests**

```typescript
describe('githubAgent', () => {
  it('should call request_review when PR touches apps/web/', async () => {
    // Setup: mock ToolCallingClient that simulates calling request_review tool
    // Setup: mock GitHubPRClient for posting comment
    // Setup: mock TaskDispatcher for dispatching review task
    // Input: pull_request event with diff containing apps/web/ files
    // Expect: taskDispatcher.dispatch called with agentType='review'
    // Expect: gitHubPRClient.postComment called with dispatch summary
  });

  it('should not dispatch when PR does NOT touch apps/web/', async () => {
    // Setup: mock ToolCallingClient that returns text-only (no tool call)
    // Input: pull_request event with only backend file changes
    // Expect: taskDispatcher.dispatch NOT called
  });

  it('should return error when getToolCallingClient fails', async () => {
    // Setup: mock userServiceClient.getToolCallingClient → err(NO_API_KEY)
    // Expect: result.ok === false
    // Expect: taskDispatcher.dispatch NOT called
  });

  it('should return error when tool calling client.run fails', async () => {
    // Setup: mock ToolCallingClient.run → err(API_ERROR)
    // Expect: result.ok === false
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter code-agent test -- --testPathPattern githubAgent`
Expected: FAIL

**Step 3: Implement the use case**

Create `apps/code-agent/src/domain/usecases/githubAgent.ts`:

```typescript
import type { Logger } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';

export interface GitHubAgentDeps {
  logger: Logger;
  userServiceClient: UserServiceClient;
  taskDispatcher: TaskDispatcherService;
  gitHubPRClient: GitHubPRClient;
}

export interface GitHubAgentRequest {
  userId: string;
  repository: string;
  prNumber: number;
  prTitle: string;
  diffSummary: string;  // file paths changed
  action: string;       // opened, synchronize, etc.
}

export interface GitHubAgentResult {
  dispatched: boolean;
  reviewTaskId?: string;
  summary: string;
}

export async function githubAgent(
  deps: GitHubAgentDeps,
  request: GitHubAgentRequest,
): Promise<Result<GitHubAgentResult, GitHubAgentError>> {
  const { logger, userServiceClient, taskDispatcher, gitHubPRClient } = deps;

  // 1. Get tool calling client
  const clientResult = await userServiceClient.getToolCallingClient(request.userId);
  if (!clientResult.ok) {
    return err({ code: 'CLIENT_ERROR', message: clientResult.error.message });
  }

  // 2. Define tools
  let dispatchedTaskId: string | undefined;
  const requestReviewTool: ToolDefinition = {
    name: 'request_review',
    description: 'Request a code review for a pull request',
    parameters: {
      type: 'object',
      properties: {
        review_type: { type: 'string', enum: ['frontend'], description: 'Type of review to request' },
      },
      required: ['review_type'],
    },
    run: async (args) => {
      const result = await taskDispatcher.dispatch({
        agentType: 'review',
        prompt: `Review PR #${request.prNumber} in ${request.repository}`,
        // ... other dispatch fields
      });
      if (result.ok) {
        dispatchedTaskId = result.value.taskId;
      }
      return JSON.stringify({ status: 'dispatched', taskId: dispatchedTaskId });
    },
  };

  // 3. Run tool calling client
  const runResult = await clientResult.value.run({
    systemPrompt: githubAgentPrompt.build(),
    messages: [{ role: 'user', content: formatPREvent(request) }],
    tools: [requestReviewTool],
    maxIterations: 3,
  });

  if (!runResult.ok) {
    return err({ code: 'LLM_ERROR', message: runResult.error.message });
  }

  // 4. Post decision comment on PR
  await gitHubPRClient.postComment(
    request.repository,
    request.prNumber,
    formatDecisionComment(runResult.value, dispatchedTaskId),
  );

  return ok({
    dispatched: dispatchedTaskId !== undefined,
    reviewTaskId: dispatchedTaskId,
    summary: runResult.value.content,
  });
}
```

**Step 4: Run tests, verify pass, commit**

---

### Task 2.3: Wire GitHub Agent into Webhook Route

**Files:**
- Modify: `apps/code-agent/src/routes/webhooks/github.ts`
- Modify: `apps/code-agent/src/services.ts`
- Test: existing webhook integration tests

**Step 1: Write failing test**

Add to webhook tests:

```typescript
it('should route pull_request opened events to GitHub Agent', async () => {
  // Setup: mock GitHub Agent use case
  // Input: valid pull_request webhook with action=opened
  // Expect: githubAgent called with correct request
});

it('should skip GitHub Agent for non-pull_request events', async () => {
  // Input: issue_comment webhook
  // Expect: githubAgent NOT called (existing dispatch logic handles it)
});
```

**Step 2: Implement the routing**

In `apps/code-agent/src/routes/webhooks/github.ts`, add a check after event parsing:

```typescript
// After existing event parsing and before rule evaluation:
if (event.eventType === 'pull_request' && ['opened', 'synchronize'].includes(event.action)) {
  // Route to GitHub Agent for LLM-based analysis
  const agentResult = await githubAgent(
    { logger, userServiceClient, taskDispatcher, gitHubPRClient },
    { userId, repository, prNumber, prTitle, diffSummary, action: event.action },
  );
  // Log result, don't block webhook response
}
```

In `apps/code-agent/src/services.ts`, ensure `userServiceClient` is available (already exists in ServiceContainer).

**Step 3: Add `getToolCallingClient` dependency to service initialization**

The `platformGeminiApiKey` must be available in the `UserServiceClient` config. Check if it's already passed in `initServices()` — if not, add it from env vars.

**Step 4: Run tests, verify pass, commit**

---

### Task 2.4: Add `'review'` to AgentType in code-agent

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (add review completion fields)
- Test: existing tests that reference AgentType

**Step 1: Write failing test**

```typescript
it('should accept review as a valid AgentType', () => {
  const agentType: AgentType = 'review';
  expect(agentType).toBe('review');
});
```

**Step 2: Update AgentType union**

In `apps/code-agent/src/domain/models/codeTask.ts`:

```typescript
export type AgentType = 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 3: Add review result fields to TaskCompleteWebhookBody**

In `apps/code-agent/src/routes/webhookRoutes.ts`, add to `TaskResult`:

```typescript
// Review agent fields
review_outcome_label?: 'reviewed';
review_findings_count?: string;
review_verdict?: 'approve' | 'request_changes' | 'comment';
```

**Step 4: Run tests, verify pass, commit**

---

## Subtask 3: Orchestrator Review Agent (workers/orchestrator + apps/web)

**Owner:** workers/orchestrator, apps/web

**Responsibility:** Add `'review'` agent type to orchestrator with dedicated system prompt, completion verifier schema, and review subagent definitions.

**Dependencies (by contract only):**
- `AgentType` includes `'review'` (Subtask 2 contract, but orchestrator has its own type definition)
- Task dispatch request includes `agentType: 'review'` (Subtask 2 contract)

### Task 3.1: Add `'review'` to Orchestrator Types

**Files:**
- Modify: `workers/orchestrator/src/types/task.ts`
- Modify: `workers/orchestrator/src/types/api.ts`
- Test: existing type tests

**Step 1: Update AgentType in task.ts**

```typescript
// In Task interface, agentType field:
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Update CreateTaskRequest in api.ts**

```typescript
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 3: Update Zod schema in schemas.ts**

Add `'review'` to the agentType enum in `CreateTaskRequestSchema`.

**Step 4: Run tests, verify pass, commit**

---

### Task 3.2: Review Agent System Prompt

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts`
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Step 1: Write failing test**

```typescript
describe('review agent prompt', () => {
  it('should build review agent prompt when agentType is review', () => {
    const prompt = buildSystemPrompt({
      taskId: 'task-1',
      linearIssueId: 'INT-100',
      linearIssueLabels: [],
      agentType: 'review',
    });
    expect(prompt).toContain('REVIEW_AGENT_FINAL');
    expect(prompt).toContain('React Patterns');
    expect(prompt).toContain('TypeScript Strict Mode');
    expect(prompt).toContain('TailwindCSS');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter orchestrator test -- --testPathPattern system-prompt`
Expected: FAIL

**Step 3: Add reviewPrompt to system-prompt.ts**

Create a new `PromptBuilder` for the review agent:

```typescript
const reviewPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-review',
  description: 'System prompt for review agent that spawns specialized subagents',
  version: '1.0.0',
  build: (params) => `[REVIEW AGENT MODE]
You are a Review Agent analyzing PR code quality.

## Your Role
You coordinate a team of review subagents, each focusing on a specific dimension.

## Review Dimensions (spawn one subagent per dimension)

| #   | Dimension              | Focus                                                                          |
| --- | ---------------------- | ------------------------------------------------------------------------------ |
| 1   | React Patterns         | Component structure, hooks, SRP ~150 lines, memoization                        |
| 2   | TypeScript Strict Mode | noUncheckedIndexedAccess, exactOptionalPropertyTypes, strictBooleanExpressions |
| 3   | TailwindCSS & Visual   | Class consistency, responsive, dark mode, UI primitives                        |
| 4   | UX Heuristics          | Loading/error/empty states, user feedback, navigation, a11y                    |
| 5   | Project Conventions    | CLAUDE.md compliance, hash routing, API patterns, env vars                     |
| 6   | Test Quality           | Coverage for utils/services/hooks, test isolation, Vitest patterns             |

## Subagent Instructions
Each subagent MUST:
1. POST a "Reviewing [dimension]..." comment on the PR immediately
2. Analyze the PR diff for findings in their dimension
3. PATCH the same comment with structured findings
4. Never POST a second comment

## Completion Block (MANDATORY)

\`\`\`
REVIEW_AGENT_FINAL:
- PR: <PR URL>
- Dimensions reviewed: <comma-separated list>
- Total findings: <number>
- Verdict: <approve|request_changes|comment>
- Summary: <3-5 sentences>
\`\`\`
`,
};
```

Update `buildSystemPrompt()` selection logic to handle `agentType === 'review'`.

**Step 4: Run test, verify pass, commit**

---

### Task 3.3: Review Agent Completion Verifier

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

**Step 1: Write failing tests**

```typescript
describe('review agent verification', () => {
  it('should extract valid REVIEW_AGENT_FINAL data', async () => {
    const rawLogs = `...
REVIEW_AGENT_FINAL:
- PR: https://github.com/org/repo/pull/123
- Dimensions reviewed: React Patterns, TypeScript Strict Mode
- Total findings: 5
- Verdict: request_changes
- Summary: Found issues with component structure and missing strict checks.
`;
    const result = await verifier.verify({
      taskId: 'task-1',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'review',
      rawLogs,
    });
    expect(result.passed).toBe(true);
    expect(result.agentData?.agentType).toBe('review');
  });

  it('should return failure when REVIEW_AGENT_FINAL is missing', async () => {
    const rawLogs = 'Some logs without completion block';
    const result = await verifier.verify({
      taskId: 'task-1',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'review',
      rawLogs,
    });
    expect(result.passed).toBe(false);
    expect(result.missingFields.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Implement review verification**

Add to `completion-verifier.ts`:

```typescript
// Add to CompletionAgentType:
export type CompletionAgentType = 'planning' | 'execution' | 'pull_request' | 'review';

// Add Zod schema:
const REVIEW_SCHEMA = z.object({
  gh_pr_url: z.string(),
  dimensions_reviewed: z.string(),
  total_findings: z.string(),
  verdict: z.string(),
  summary: z.string(),
});

// Add ReviewAgentData interface:
export interface ReviewAgentData {
  agentType: 'review';
  gh_pr_url: string;
  dimensions_reviewed: string;
  total_findings: string;
  verdict: string;
  summary: string;
}

// Update CompletionVerifierVerdict.agentData union:
agentData?: PlanningAgentData | ExecutionAgentData | PullRequestAgentData | ReviewAgentData;
```

Add `buildReviewPrompt()` function and update the `verify()` method switch to handle `'review'`.

**Step 3: Run tests, verify pass, commit**

---

### Task 3.4: Web App AgentType Update

**Files:**
- Modify: `apps/web/src/types/index.ts` (or wherever CodeTask type is defined)

**Step 1: Find and update the AgentType in web app**

Search for the agent type definition in apps/web and add `'review'` to it. This is a type-only change with no runtime behavior to test.

**Step 2: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(web): add review to CodeTask agentType"
```

---

## Verification

After all subtasks complete, run from repo root:

```bash
pnpm run ci:tracked
```

All workspaces must pass: llm-contract, infra-gemini, llm-factory, internal-clients, code-agent, orchestrator, web.

## Endpoint Changes

### Modified
- `POST /webhooks/github` (code-agent) — Now routes `pull_request` events with `action=opened|synchronize` to GitHub Agent use case before existing dispatch logic

### Created
- None (review tasks dispatched through existing `POST /tasks` orchestrator endpoint with `agentType: 'review'`)

### Removed
- None

### Unchanged
- `POST /tasks` (orchestrator) — Accepts new `agentType: 'review'` value but endpoint itself unchanged
- `GET /health` (orchestrator)
- All other code-agent routes
