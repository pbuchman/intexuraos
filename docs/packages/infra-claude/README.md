# @intexuraos/infra-claude

Anthropic Claude API wrapper implementing the `LLMClient` interface from `@intexuraos/llm-contract`.

## What It Wraps

- **External API:** Anthropic Messages API via `@anthropic-ai/sdk` (v0.52+)
- **Provider:** `LlmProviders.Anthropic`
- **Capabilities:** Text generation, web search research (via `web_search_20250305` tool), prompt caching with cost tracking

## API Reference

### `createClaudeClient(config: ClaudeConfig): ClaudeClient`

Factory function that returns an `LLMClient` instance configured for Anthropic Claude.

```ts
import { createClaudeClient } from '@intexuraos/infra-claude';

const client = createClaudeClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-5',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.0035,
  },
  logger: pinoLogger,
});
```

**Methods on the returned client:**

| Method             | Signature                                                          | Description                                      |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------ |
| `research(prompt)` | `(prompt: string) => Promise<Result<ResearchResult, ClaudeError>>` | Web search research using Claude's built-in tool |
| `generate(prompt)` | `(prompt: string) => Promise<Result<GenerateResult, ClaudeError>>` | Text generation without web search               |

### `calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number`

Calculates the USD cost for a text operation based on token usage and pricing. Accounts for regular input, cache read/write tokens, output tokens, and web search calls.

### `normalizeUsage(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, webSearchCalls, pricing): NormalizedUsage`

Converts raw Anthropic usage data into the standardized `NormalizedUsage` format. Aggregates cache read and write tokens into the single `cacheTokens` field.

## Exported Types

| Type             | Description                                      |
| ---------------- | ------------------------------------------------ |
| `ClaudeClient`   | Type alias for `LLMClient`                       |
| `ClaudeConfig`   | Configuration interface for `createClaudeClient` |
| `ClaudeError`    | Re-export of `LLMError` from `llm-contract`      |
| `ResearchResult` | Re-export from `llm-contract`                    |
| `GenerateResult` | Re-export from `llm-contract`                    |
| `SynthesisInput` | Re-export from `llm-contract`                    |

### ClaudeConfig

```ts
interface ClaudeConfig {
  apiKey: string;   // Anthropic API key
  model: string;    // e.g., 'claude-sonnet-4-5', 'claude-haiku-3-5'
  userId: string;   // User ID for usage tracking
  pricing: ModelPricing; // Cost configuration per million tokens
  logger: Logger;   // Pino logger for structured logging
}
```

## Configuration

### Environment Variables

| Variable                       | Description       | Required |
| ------------------------------ | ----------------- | -------- |
| `INTEXURAOS_ANTHROPIC_API_KEY` | Anthropic API key | Yes      |

### Pricing Fields

| Field                   | Type   | Description                                         |
| ----------------------- | ------ | --------------------------------------------------- |
| `inputPricePerMillion`  | number | Cost per million input tokens                       |
| `outputPricePerMillion` | number | Cost per million output tokens                      |
| `cacheReadMultiplier`   | number | Multiplier for cache read tokens (default 0.1)      |
| `cacheWriteMultiplier`  | number | Multiplier for cache creation tokens (default 1.25) |
| `webSearchCostPerCall`  | number | Cost per web search tool invocation                 |

## Error Handling

All methods return `Result<T, ClaudeError>`. Error mapping:

| HTTP Status / Condition    | Error Code     | Description              |
| -------------------------- | -------------- | ------------------------ |
| 401                        | `INVALID_KEY`  | Invalid API key          |
| 429                        | `RATE_LIMITED` | Rate limit exceeded      |
| 529                        | `OVERLOADED`   | Anthropic API overloaded |
| Message contains "timeout" | `TIMEOUT`      | Request timed out        |
| Other `APIError`           | `API_ERROR`    | General API error        |

## Implementation Notes

- **Cache tracking:** The Anthropic SDK does not expose `cache_read_input_tokens` and `cache_creation_input_tokens` as typed fields. These are extracted via `as` casts on the usage object.
- **Web search:** Uses the `web_search_20250305` tool type, passed with `as const` assertions to satisfy the SDK's type union.
- **Source extraction:** URLs are extracted both from text block content (regex) and from `web_search_tool_result` blocks.
- **Audit sink:** This client does not accept injectable `auditSink`/`usageSink` — it uses the default Firestore sinks.
- **MAX_TOKENS:** Hardcoded to 8192.

## Cross-Cutting Concerns

- **Audit trail:** Every request creates an `AuditContext` via `@intexuraos/llm-audit`
- **Usage logging:** Automatic fire-and-forget logging via `@intexuraos/llm-pricing` `UsageLogger`
- **Prompt building:** Research prompts are built via `@intexuraos/llm-prompts` `buildResearchPrompt()`

## Used By

| App / Package    | Purpose                      |
| ---------------- | ---------------------------- |
| `research-agent` | Research operations          |
| `user-service`   | API key validation and usage |

## Dependencies

| Package                     | Role                                                     |
| --------------------------- | -------------------------------------------------------- |
| `@anthropic-ai/sdk` ^0.52.0 | Anthropic Messages API client                            |
| `@intexuraos/common-core`   | `Result` types, `getErrorMessage`, `Logger`              |
| `@intexuraos/llm-contract`  | `LLMClient` interface, `NormalizedUsage`, `ModelPricing` |
| `@intexuraos/llm-prompts`   | `buildResearchPrompt`                                    |
| `@intexuraos/llm-audit`     | `createAuditContext`                                     |
| `@intexuraos/llm-pricing`   | `createUsageLogger`                                      |

## Recent Changes

| Commit      | Description                                                  | When        |
| ----------- | ------------------------------------------------------------ | ----------- |
| `c4e3a13c`  | Release v3.3.0                                               | 2 hours ago |
| `51b4a325`  | Migrate LLM clients to UsageLogger class                     | 4 weeks ago |
| `8aad9098`  | Migrate imports and delete llm-common                        | 4 weeks ago |
| `816afa55`  | Add ESLint rule to ban optional logger parameters            | 5 weeks ago |
| `6ec4205e`  | Make logger mandatory in all LLM configs                     | 5 weeks ago |
