# @intexuraos/llm-factory - Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/llm-factory
version: 2.1.0
type: module
leaf: false
dependencies: @intexuraos/common-core, @intexuraos/infra-gemini, @intexuraos/infra-glm, @intexuraos/llm-contract, @intexuraos/llm-pricing
entry_points:
  - ".": ./src/index.ts
```

## Exported Types

```typescript
interface LlmClientConfig {
  apiKey: string;
  model: LLMModel;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;   // from @intexuraos/llm-audit
  usageSink?: UsageSink;   // from @intexuraos/llm-pricing
}

interface GenerateResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
}

interface LlmGenerateClient {
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
}

// Re-exported from @intexuraos/llm-contract
interface LLMError {
  code: LLMErrorCode;
  message: string;
}
```

## Exported Functions

```typescript
function createLlmClient(config: LlmClientConfig): LlmGenerateClient;
function isSupportedProvider(provider: string): provider is 'google' | 'zai';
```

## Dependency Graph

```
common-core
  <- llm-contract
       <- llm-factory
            uses: infra-gemini, infra-glm, llm-pricing, llm-audit
            <- internal-clients
            <- 10 apps (actions-agent, bookmarks-agent, calendar-agent, chat-agent,
                        commands-agent, data-insights-agent, linear-agent,
                        research-agent, todos-agent, web-agent)
            <- workers/orchestrator
```

## Usage Patterns

```typescript
// Standard factory usage
import { createLlmClient } from '@intexuraos/llm-factory';

const client = createLlmClient({
  apiKey: process.env['INTEXURAOS_GEMINI_API_KEY']!,
  model: 'gemini-2.5-flash',
  userId: 'user-123',
  pricing: pricingContext.getPricing('gemini-2.5-flash'),
  logger,
});

const result = await client.generate(prompt);
if (!result.ok) {
  logger.error({ error: result.error }, 'LLM generation failed');
  return;
}
console.log(result.value.content);

// Guard check before creating client
import { isSupportedProvider } from '@intexuraos/llm-factory';
if (isSupportedProvider(userSelectedProvider)) {
  const client = createLlmClient({ ... });
}
```

## Test Mock Pattern

```typescript
const mockClient: LlmGenerateClient = {
  generate: vi.fn().mockResolvedValue(
    ok({
      content: 'mock response',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    })
  ),
};
```
