# @intexuraos/infra-perplexity

Perplexity AI client implementation for IntexuraOS.

## Installation

This is an internal package - installed via workspace protocol.

## Usage

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
  timeoutMs: 840000, // 14 minutes for deep research
});

// Research with online search
const researchResult = await client.research('Latest AI developments');
if (researchResult.ok) {
  console.log(researchResult.data.content);
  console.log('Sources:', researchResult.data.sources);
  console.log('Cost:', researchResult.data.usage.costUsd);
}

// Simple generation
const result = await client.generate('What is the capital of France?');
if (result.ok) {
  console.log(result.data.content);
}
```

## API

### `createPerplexityClient(config)`

| Parameter | Type         | Required | Description                                       |
| --------- | ------------ | -------- | ------------------------------------------------- |
| apiKey    | string       | Yes      | Perplexity API key from perplexity.ai             |
| model     | string       | Yes      | Model ID (e.g., 'sonar', 'sonar-pro')             |
| userId    | string       | Yes      | User ID for usage tracking                        |
| pricing   | ModelPricing | Yes      | Cost configuration per million tokens             |
| timeoutMs | number       | No       | Request timeout in milliseconds (default: 840000) |

### Methods

#### `research(prompt: string)`

Performs online search research with source citations.
Uses SSE streaming for long-running reasoning models.

**Returns:** `Promise<Result<ResearchResult, PerplexityError>>`

#### `generate(prompt: string)`

Generates text completion with online search context.

**Returns:** `Promise<Result<GenerateResult, PerplexityError>>`

## Error Codes

| Code           | Description                  | Recommended Action               |
| -------------- | ---------------------------- | -------------------------------- |
| INVALID_KEY    | API key is invalid           | Check PERPLEXITY_API_KEY env var |
| RATE_LIMITED   | Rate limit exceeded          | Implement exponential backoff    |
| OVERLOADED     | Perplexity API is overloaded | Retry after delay                |
| TIMEOUT        | Request timed out            | Increase timeoutMs config        |
| CONTEXT_LENGTH | Prompt too long              | Truncate and retry               |
| API_ERROR      | Other API errors             | Check message for details        |

## Streaming

The `research()` method uses Server-Sent Events (SSE) streaming to prevent
5-minute idle timeouts on long-running reasoning models like `sonar-deep-research`.

## Supported Models

| Model               | Description          | Search Context |
| ------------------- | -------------------- | -------------- |
| sonar               | Fast, cost-effective | Low            |
| sonar-pro           | Balanced performance | Medium         |
| sonar-deep-research | Extended reasoning   | High           |
