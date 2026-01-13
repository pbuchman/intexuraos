# @intexuraos/infra-gemini

Google Gemini client implementation for IntexuraOS.

## Installation

This is an internal package - installed via workspace protocol.

## Usage

```ts
import { createGeminiClient } from '@intexuraos/infra-gemini';

const client = createGeminiClient({
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-2.5-flash',
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.30,
    groundingCostPerRequest: 0.002,
  }
});

// Research with grounding
const researchResult = await client.research('Latest TypeScript features');
if (researchResult.ok) {
  console.log(researchResult.data.content);
  console.log('Sources:', researchResult.data.sources);
  console.log('Cost:', researchResult.data.usage.costUsd);
}

// Simple generation
const result = await client.generate('Explain quantum computing');
if (result.ok) {
  console.log(result.data.content);
}

// Image generation (Gemini 2.5 Flash only)
const imageResult = await client.generateImage('A cat sitting on a fence', { size: '1024x1024' });
if (imageResult.ok) {
  console.log('Image generated, size:', imageResult.data.imageData.length);
}
```

## API

### `createGeminiClient(config)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| apiKey | string | Yes | Google API key from console.cloud.google.com |
| model | string | Yes | Model ID (e.g., 'gemini-2.5-pro', 'gemini-2.5-flash') |
| userId | string | Yes | User ID for usage tracking |
| pricing | ModelPricing | Yes | Cost configuration per million tokens |
| imagePricing | ModelPricing | No | Separate pricing for image generation |

### Methods

#### `research(prompt: string)`
Performs research using Google Search grounding.

**Returns:** `Promise<Result<ResearchResult, GeminiError>>`

#### `generate(prompt: string)`
Generates text completion without search.

**Returns:** `Promise<Result<GenerateResult, GeminiError>>`

#### `generateImage(prompt, options?)`
Generates images (Gemini 2.5 Flash only).

**Returns:** `Promise<Result<ImageGenerationResult, GeminiError>>`

## Error Codes

| Code | Description | Recommended Action |
|------|-------------|-------------------|
| INVALID_KEY | API key is invalid | Check GOOGLE_API_KEY env var |
| RATE_LIMITED | Rate limit exceeded | Implement exponential backoff |
| OVERLOADED | Google API is overloaded | Retry after delay |
| TIMEOUT | Request timed out | Retry with longer timeout |
| CONTEXT_LENGTH | Prompt too long | Truncate and retry |
| API_ERROR | Other API errors | Check message for details |

## Supported Models

| Model | Description |
|-------|-------------|
| gemini-2.5-pro | Highest quality, reasoning |
| gemini-2.5-flash | Fast, cost-effective |
| gemini-2.5-flash-image | Image generation |
