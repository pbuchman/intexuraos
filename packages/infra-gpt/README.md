# @intexuraos/infra-gpt

OpenAI GPT client implementation for IntexuraOS.

## Installation

This is an internal package - installed via workspace protocol.

## Usage

```ts
import { createGptClient } from '@intexuraos/infra-gpt';

const client = createGptClient({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4.1',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  imagePricing: {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    imagePricing: {
      '1024x1024': 0.04,
      '1536x1024': 0.05,
      '1024x1536': 0.05,
    },
  },
});

// Research with web search
const researchResult = await client.research('Latest TypeScript features');
if (researchResult.ok) {
  console.log(researchResult.data.content);
  console.log('Sources:', researchResult.data.sources);
  console.log('Cost:', researchResult.data.usage.costUsd);
}

// Simple generation
const result = await client.generate('Explain TypeScript');
if (result.ok) {
  console.log(result.data.content);
}

// Image generation
const imageResult = await client.generateImage('A sunset over mountains', { size: '1024x1024' });
if (imageResult.ok) {
  // imageResult.data.imageData is a Buffer with PNG data
  console.log('Image generated, size:', imageResult.data.imageData.length);
}
```

## API

### `createGptClient(config)`

| Parameter    | Type         | Required | Description                               |
| ------------ | ------------ | -------- | ----------------------------------------- |
| apiKey       | string       | Yes      | OpenAI API key from platform.openai.com   |
| model        | string       | Yes      | Model ID (e.g., 'gpt-4.1', 'gpt-4o-mini') |
| userId       | string       | Yes      | User ID for usage tracking                |
| pricing      | ModelPricing | Yes      | Cost configuration per million tokens     |
| imagePricing | ModelPricing | No       | Separate pricing for image generation     |

### Methods

#### `research(prompt: string)`

Performs research using OpenAI's web search preview tool.

**Returns:** `Promise<Result<ResearchResult, GptError>>`

#### `generate(prompt: string)`

Generates text completion without web search.

**Returns:** `Promise<Result<GenerateResult, GptError>>`

#### `generateImage(prompt, options?)`

Generates images using DALL-E (gpt-image-1 model).

**Returns:** `Promise<Result<ImageGenerationResult, GptError>>`

## Error Codes

| Code           | Description              | Recommended Action            |
| -------------- | ------------------------ | ----------------------------- |
| INVALID_KEY    | API key is invalid       | Check OPENAI_API_KEY env var  |
| RATE_LIMITED   | Rate limit exceeded      | Implement exponential backoff |
| OVERLOADED     | OpenAI API is overloaded | Retry after delay             |
| TIMEOUT        | Request timed out        | Retry with longer timeout     |
| CONTEXT_LENGTH | Prompt too long          | Truncate and retry            |
| API_ERROR      | Other API errors         | Check message for details     |

## Supported Models

| Model                 | Description                        |
| --------------------- | ---------------------------------- |
| gpt-4.1               | Latest GPT-4 model                 |
| gpt-4o-mini           | Faster, cost-effective             |
| o4-mini-deep-research | Extended reasoning with web search |
| gpt-image-1           | Image generation                   |
