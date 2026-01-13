# @intexuraos/infra-claude

Anthropic Claude AI client implementation for IntexuraOS.

## Installation

This is an internal package - installed via workspace protocol.

## Usage

```ts
import { createClaudeClient } from '@intexuraos/infra-claude';

const client = createClaudeClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-5',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 3.00,
    outputPricePerMillion: 15.00,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.0035,
  }
});

// Research with web search
const researchResult = await client.research('Latest TypeScript features');
if (researchResult.ok) {
  console.log(researchResult.data.content);
  console.log('Sources:', researchResult.data.sources);
  console.log('Cost:', researchResult.data.usage.costUsd);
}

// Simple generation
const result = await client.generate('Explain TypeScript in one sentence');
if (result.ok) {
  console.log(result.data.content);
} else {
  console.error(result.error.code, result.error.message);
}
```

## API

### `createClaudeClient(config)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| apiKey | string | Yes | Anthropic API key from console.anthropic.com |
| model | string | Yes | Model ID (e.g., 'claude-sonnet-4-5', 'claude-haiku-3-5') |
| userId | string | Yes | User ID for usage tracking |
| pricing | ModelPricing | Yes | Cost configuration per million tokens |

### Methods

#### `research(prompt: string)`
Performs web search research using Claude's built-in `web_search_20250305` tool.

**Returns:** `Promise<Result<ResearchResult, ClaudeError>>`

- `content`: Research response with current information
- `sources`: Array of URLs from web search results
- `usage`: Token usage and cost information

#### `generate(prompt: string)`
Generates text completion without web search (training data only).

**Returns:** `Promise<Result<GenerateResult, ClaudeError>>`

- `content`: Generated text
- `usage`: Token usage and cost information

## Error Codes

| Code | Description | Recommended Action |
|------|-------------|-------------------|
| INVALID_KEY | API key is invalid | Check ANTHROPIC_API_KEY env var |
| RATE_LIMITED | Rate limit exceeded | Implement exponential backoff |
| OVERLOADED | Anthropic API is overloaded | Retry after delay |
| TIMEOUT | Request timed out | Retry with longer timeout |
| CONTEXT_LENGTH | Prompt too long | Truncate and retry |
| API_ERROR | Other API errors | Check message for details |

## Cost Tracking

All methods return a `NormalizedUsage` object:

```ts
interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cacheTokens?: number;      // Prompt cache read tokens (discounted)
  webSearchCalls?: number;    // Number of web search calls (research only)
}
```

Costs are automatically calculated from the provided `pricing` config and logged
to Firestore for analytics.

## Supported Models

| Model | Description |
|-------|-------------|
| claude-sonnet-4-5 | Balanced performance and speed |
| claude-opus-4-5 | Highest quality, slower |
| claude-haiku-3-5 | Fastest, most cost-effective |
