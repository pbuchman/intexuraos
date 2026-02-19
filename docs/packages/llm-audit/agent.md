# @intexuraos/llm-audit - Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/llm-audit
version: 2.1.0
type: module
leaf: false
dependencies: @intexuraos/common-core, @intexuraos/infra-firestore, @intexuraos/llm-contract
entry_points:
  - ".": ./src/index.ts
firestore_collections:
  - llm_api_logs (owned)
env_vars:
  - INTEXURAOS_AUDIT_LLMS (optional, default: true)
```

## Exported Types

```typescript
// Re-exported from llm-contract
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';

type LlmAuditStatus = 'success' | 'error';

interface LlmAuditLog {
  id: string;
  provider: LlmProvider;
  model: string;
  method: string;
  prompt: string;
  promptLength: number;
  status: LlmAuditStatus;
  response?: string;
  responseLength?: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
  providerCost?: number;
  costUsd?: number;
  imageCount?: number;
  imageModel?: string;
  imageSize?: string;
  imageCostUsd?: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  userId?: string;
  researchId?: string;
  createdAt: string;
}

interface CreateAuditLogParams {
  provider: LlmProvider;
  model: string;
  method: string;
  prompt: string;
  startedAt: Date;
  userId?: string;
  researchId?: string;
}

interface CompleteAuditLogSuccessParams {
  response: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
  providerCost?: number;
  costUsd?: number;
  imageCount?: number;
  imageModel?: string;
  imageSize?: string;
  imageCostUsd?: number;
}

interface CompleteAuditLogErrorParams {
  error: string;
}
```

## Exported Functions

```typescript
function isAuditEnabled(): boolean;
function createAuditContext(params: CreateAuditLogParams): AuditContext;
```

## Exported Classes

```typescript
class AuditContext {
  constructor(params: CreateAuditLogParams);
  async success(result: CompleteAuditLogSuccessParams): Promise<void>;
  async error(result: CompleteAuditLogErrorParams): Promise<void>;
}
```

## Dependency Graph

```
common-core, llm-contract, infra-firestore
  <- llm-audit
       <- infra-claude, infra-gemini, infra-glm, infra-gpt, infra-perplexity
       <- llm-factory (AuditSink type import)
       <- image-service
       <- workers/orchestrator (AuditSink type import)
```

## Usage Patterns

```typescript
// Standard audit flow
import { createAuditContext } from '@intexuraos/llm-audit';

const audit = createAuditContext({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  method: 'research',
  prompt: userQuery,
  startedAt: new Date(),
  userId: currentUserId,
});

try {
  const result = await llmClient.research(userQuery);
  if (result.ok) {
    await audit.success({
      response: result.value.content,
      inputTokens: result.value.usage.inputTokens,
      outputTokens: result.value.usage.outputTokens,
      costUsd: result.value.usage.costUsd,
      webSearchCalls: result.value.usage.webSearchCalls,
    });
  } else {
    await audit.error({ error: `${result.error.code}: ${result.error.message}` });
  }
} catch (error) {
  await audit.error({ error: getErrorMessage(error) });
}

// Check if auditing is active
import { isAuditEnabled } from '@intexuraos/llm-audit';
if (!isAuditEnabled()) {
  logger.info({}, 'LLM auditing is disabled');
}
```

## Test Mock Pattern

```typescript
// Mock the entire module
vi.mock('@intexuraos/llm-audit', () => ({
  isAuditEnabled: vi.fn().mockReturnValue(false),
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
  AuditContext: vi.fn(),
}));
```
