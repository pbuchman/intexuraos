# @intexuraos/infra-perplexity

Perplexity AI API wrapper implementing `research` and `generate` from the `LLMClient` interface. Uses raw HTTP fetch (no SDK) with SSE streaming support for long-running deep research models.

## What It Wraps

- **External API:** Perplexity Chat Completions API (`https://api.perplexity.ai/chat/completions`)
- **Provider:** `LlmProviders.Perplexity`
- **Capabilities:** Online search with source citations, SSE streaming for research, buffered JSON for generation
- **No SDK dependency:** Uses native `fetch` with custom timeout handling

## API Reference

### `createPerplexityClient(config: PerplexityConfig): PerplexityClient`

Factory function that returns a client with `research()` and `generate()` methods.

```ts
import { createPerplexityClient } from '@intexuraos/infra-perplexity';

const client = createPerplexityClient({
  apiKey: process.env.PERPLEXITY_API_KEY,
  model: 'sonar-pro',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 1.0,
  },
  timeoutMs: 840000,
  logger: pinoLogger,
});
```

**Methods on the returned client:**

| Method             | Signature                                                              | Description                                 |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------- |
| `research(prompt)` | `(prompt: string) => Promise<Result<ResearchResult, PerplexityError>>` | SSE-streamed research with source citations |
| `generate(prompt)` | `(prompt: string) => Promise<Result<GenerateResult, PerplexityError>>` | Buffered text generation                    |

**Note:** `PerplexityClient` is typed as `Pick<LLMClient, 'research' | 'generate'>` -- it does not support `generateImage`.

### `calculateTextCost(usage: TokenUsage, pricing: ModelPricing, providerCost: number | undefined): number`

Calculates USD cost with a two-tier strategy:

1. **Priority:** Uses direct provider cost if `pricing.useProviderCost` is true and `providerCost` is available, or if `usage.providerCost` is set
2. **Fallback:** Calculates from input/output token prices plus per-request fees

### `normalizeUsage(inputTokens, outputTokens, providerCost, pricing): NormalizedUsage`

Converts raw Perplexity usage data into `NormalizedUsage`. Always sets `webSearchCalls: 1` since every Perplexity request involves search.

## Exported Types

| Type               | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `PerplexityClient` | `Pick<LLMClient, 'research' \                           | 'generate'>` |
| `PerplexityConfig` | Configuration interface                                 |
| `PerplexityError`  | Re-export of `LLMError` from `@intexuraos/llm-contract` |
| `ResearchResult`   | Re-export from `@intexuraos/llm-contract`               |
| `GenerateResult`   | Re-export from `@intexuraos/llm-contract`               |

### PerplexityConfig

```ts
interface PerplexityConfig {
  apiKey: string; // Perplexity API key
  model: string; // e.g., 'sonar', 'sonar-pro', 'sonar-deep-research'
  userId: string; // User ID for usage tracking
  pricing: ModelPricing; // Cost configuration per million tokens
  timeoutMs?: number; // Request timeout (default: 840000ms / 14 minutes)
  logger: Logger; // Pino logger for structured logging
}
```

### Internal Types (not exported)

| Type                     | Description                                    |
| ------------------------ | ---------------------------------------------- |
| `PerplexityRequestBody`  | Request body for the chat completions endpoint |
| `PerplexityResponse`     | Full JSON response structure                   |
| `PerplexityUsage`        | Usage including cost breakdown                 |
| `PerplexityCost`         | Cost breakdown with input/output/request/total |
| `PerplexitySearchResult` | Search result metadata with title/url/date     |
| `SearchContextSize`      | `'low' \                                       | 'medium' \ | 'high'` |

## Configuration

### Environment Variables

| Variable                        | Description        | Required |
| ------------------------------- | ------------------ | -------- |
| `INTEXURAOS_PERPLEXITY_API_KEY` | Perplexity API key | Yes      |

### Search Context Mapping

The search context size is automatically determined by model:

| Model                 | Context Size |
| --------------------- | ------------ |
| `sonar`               | `low`        |
| `sonar-pro`           | `medium`     |
| `sonar-deep-research` | `high`       |
| Other                 | `medium`     |

## Error Handling

All methods return `Result<T, PerplexityError>`. Error mapping:

| Condition                                  | Error Code     | Description            |
| ------------------------------------------ | -------------- | ---------------------- |
| HTTP 401                                   | `INVALID_KEY`  | Invalid API key        |
| HTTP 429                                   | `RATE_LIMITED` | Rate limit exceeded    |
| HTTP 503                                   | `OVERLOADED`   | Service overloaded     |
| `AbortError`                               | `TIMEOUT`      | Request timed out      |
| Contains "timeout"/"fetch failed"/"stream" | `TIMEOUT`      | Network/stream timeout |
| Other errors                               | `API_ERROR`    | General API error      |

## Implementation Notes

- **Streaming for research:** The `research()` method enables `stream: true` in the request body and processes Server-Sent Events (SSE) to prevent 5-minute idle timeouts on long-running models like `sonar-deep-research`
- **Buffered for generate:** The `generate()` method uses standard JSON response
- **Timeout handling:** Uses `AbortController` with configurable timeout (default 14 minutes, below Cloud Run's 15-minute limit)
- **SSE parsing:** Custom stream processor handles buffered line splitting, `[DONE]` sentinel, content delta accumulation, usage extraction, and citation capture

## Cross-Cutting Concerns

- **Audit trail:** Every request creates an `AuditContext` via `@intexuraos/llm-audit`
- **Usage logging:** Automatic fire-and-forget logging via `@intexuraos/llm-pricing` `UsageLogger`
- **Prompt building:** Research prompts built via `@intexuraos/llm-prompts` `buildResearchPrompt()`
- **Max tokens:** Hardcoded to 8192

## Used By

| App / Package    | Purpose                             |
| ---------------- | ----------------------------------- |
| `research-agent` | Deep research with source citations |
| `user-service`   | API key validation and usage        |

## Recent Changes

| Commit     | Description                                           | When        |
| ---------- | ----------------------------------------------------- | ----------- |
| `5aa3e1bd` | Enable strict 100% coverage enforcement (Phase 3)     | 8 days ago  |
| `7872eabb` | Phase 2: Fix v8-ignore script and begin coverage work | 8 days ago  |
| `766ae429` | Add tests for branch coverage gaps in packages        | 13 days ago |
| `51b4a325` | Migrate LLM clients to UsageLogger class              | 2 weeks ago |
| `8aad9098` | Migrate imports and delete llm-common                 | 2 weeks ago |
