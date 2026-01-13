# Plan: Improve `infra-*` Packages Documentation

**Status:** Pending Approval
**Created:** 2026-01-13
**Context:** Investigation of AI SDK documentation patterns revealed gaps in our infra package documentation

## Decision: NOT Migrating to AI SDK

After investigation, we decided **against** migrating to AI SDK because:

1. **Our custom infra provides production-grade features AI SDK lacks:**
   - Per-user cost tracking with Firestore aggregation
   - Full audit logging (`llm-audit`)
   - Usage analytics by day/month/period
   - Custom error codes with specific handling
   - Prompt caching cost tracking
   - Web search call tracking
   - Image generation pricing

2. **AI SDK provides DX features we don't currently need:**
   - Streaming (not required for current use cases)
   - Tool calling (only using Claude web search)
   - Structured output (manual JSON parsing sufficient)
   - React hooks (not used in services)

3. **Migration cost outweighs benefits:**
   - Would need to rebuild all cost/usage tracking on top of AI SDK
   - AI SDK is changing rapidly (v6 beta) - breaking changes
   - Current interface (`LLMClient`) is clean and working

## Approach: Enhance Existing Documentation

We will improve documentation for the existing `infra-*` packages using AI SDK's documentation patterns as inspiration.

## Affected Packages

| Package            | Purpose                     | Priority |
| ------------------ | --------------------------- | -------- |
| `infra-claude`     | Anthropic Claude client     | High     |
| `infra-gpt`        | OpenAI GPT client           | High     |
| `infra-gemini`     | Google Gemini client        | High     |
| `infra-perplexity` | Perplexity client           | Medium   |
| `llm-contract`     | Shared types and interfaces | High     |
| `llm-pricing`      | Usage logging and pricing   | High     |
| `llm-audit`        | Audit logging to Firestore  | Medium   |

## Tasks

### 1. Add Comprehensive JSDoc to Client Factories

**Files:**

- `packages/infra-claude/src/client.ts`
- `packages/infra-gpt/src/client.ts`
- `packages/infra-gemini/src/client.ts`
- `packages/infra-perplexity/src/client.ts`

**Pattern to Follow:**

````typescript
/**
 * Creates a configured Claude AI client with parameterized pricing.
 *
 * The client implements the {@link LLMClient} interface with {@link research()}
 * and {@link generate()} methods. All costs are calculated from the passed
 * {@link ModelPricing} config.
 *
 * @example
 * ```ts
 * import { createClaudeClient } from '@intexuraos/infra-claude';
 *
 * const client = createClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5',
 *   userId: 'user-123',
 *   pricing: {
 *     inputCostPer1k: 0.003,
 *     outputCostPer1k: 0.015,
 *     cacheReadCostPer1k: 0.0003,
 *   }
 * });
 *
 * const result = await client.generate('Hello, world!');
 * if (result.ok) {
 *   console.log(result.data.content);
 *   console.log(`Cost: $${result.data.usage.costUsd}`);
 * } else {
 *   console.error(result.error.code, result.error.message);
 * }
 * ```
 *
 * @param config - Configuration for the Claude client
 * @param config.apiKey - Anthropic API key from console.anthropic.com
 * @param config.model - Model identifier (e.g., 'claude-sonnet-4-5', 'claude-haiku-3-5')
 * @param config.userId - User ID for usage tracking and analytics
 * @param config.pricing - Cost configuration per 1k tokens
 * @returns A configured {@link LLMClient} instance
 */
export function createClaudeClient(config: ClaudeConfig): ClaudeClient;
````

### 2. Document LLM Contract Types

**File:** `packages/llm-contract/src/types.ts`

Add comprehensive JSDoc to:

- `LLMClient` interface
- `LLMError` type
- `NormalizedUsage` interface
- `ResearchResult`, `GenerateResult`, `ImageGenerationResult`

**Pattern for Error Codes:**

````typescript
/**
 * Error codes that can be returned by LLM client operations.
 *
 * @remarks
 * All errors are returned as `LLMError` objects with a `code` and `message`.
 * Use pattern matching to handle different error cases:
 *
 * ```ts
 * const result = await client.generate('...');
 * if (!result.ok) {
 *   switch (result.error.code) {
 *     case 'RATE_LIMITED':
 *       // Implement backoff retry
 *       break;
 *     case 'CONTEXT_LENGTH':
 *       // Truncate prompt and retry
 *       break;
 *     default:
 *       // Log and handle
 *   }
 * }
 * ```
 */
export type LLMErrorCode =
  /** General API error - check `message` for details */
  | 'API_ERROR'
  /** Request timed out - retry with exponential backoff */
  | 'TIMEOUT'
  /** API key is invalid or not provided */
  | 'INVALID_KEY'
  /** Rate limit exceeded - implement backoff retry */
  | 'RATE_LIMITED'
  /** Provider API is overloaded - retry after delay */
  | 'OVERLOADED'
  /** Prompt exceeds model context window */
  | 'CONTEXT_LENGTH'
  /** Content was filtered by provider safety systems */
  | 'CONTENT_FILTERED';
````

### 3. Create README.md for Each Infra Package

**Files to Create:**

- `packages/infra-claude/README.md`
- `packages/infra-gpt/README.md`
- `packages/infra-gemini/README.md`
- `packages/infra-perplexity/README.md`
- `packages/llm-contract/README.md`
- `packages/llm-pricing/README.md`
- `packages/llm-audit/README.md`

**Template Structure:**

```markdown
# @intexuraos/infra-claude

Anthropic Claude AI client implementation for IntexuraOS.

## Installation

This is an internal package - installed via workspace protocol.

## Usage

\`\`\`ts
import { createClaudeClient } from '@intexuraos/infra-claude';

const client = createClaudeClient({
apiKey: process.env.ANTHROPIC_API_KEY,
model: 'claude-sonnet-4-5',
userId: 'user-123',
pricing: { ... }
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
} else {
console.error(result.error.code, result.error.message);
}
\`\`\`

## API

### `createClaudeClient(config)`

| Parameter | Type         | Required | Description                      |
| --------- | ------------ | -------- | -------------------------------- |
| apiKey    | string       | Yes      | Anthropic API key                |
| model     | string       | Yes      | Model ID                         |
| userId    | string       | Yes      | User ID for usage tracking       |
| pricing   | ModelPricing | Yes      | Cost configuration per 1k tokens |

### Methods

#### `research(prompt: string)`

Performs web search research using Claude's built-in web search tool.

**Returns:** `Promise<Result<ResearchResult, ClaudeError>>`

#### `generate(prompt: string)`

Generates text completion without web search.

**Returns:** `Promise<Result<GenerateResult, ClaudeError>>`

## Error Codes

| Code           | Description                 | Recommended Action              |
| -------------- | --------------------------- | ------------------------------- |
| INVALID_KEY    | API key is invalid          | Check ANTHROPIC_API_KEY env var |
| RATE_LIMITED   | Rate limit exceeded         | Implement exponential backoff   |
| OVERLOADED     | Anthropic API is overloaded | Retry after delay               |
| TIMEOUT        | Request timed out           | Retry with longer timeout       |
| CONTEXT_LENGTH | Prompt too long             | Truncate and retry              |
| API_ERROR      | Other API errors            | Check message for details       |

## Cost Tracking

All methods return a `NormalizedUsage` object:

\`\`\`ts
interface NormalizedUsage {
inputTokens: number;
outputTokens: number;
totalTokens: number;
costUsd: number;
cacheTokens?: number; // Prompt cache read tokens
webSearchCalls?: number; // Number of web search calls (research only)
}
\`\`\`

Costs are automatically calculated from the provided `pricing` config and logged
to Firestore for analytics.
```

### 4. Document Pricing and Audit Functions

**Files:**

- `packages/llm-pricing/src/usageLogger.ts`
- `packages/llm-pricing/src/pricingClient.ts`
- `packages/llm-audit/src/audit.ts`

Add JSDoc explaining:

- How usage is aggregated (by model, call type, period)
- Firestore structure for usage stats
- Audit log structure and purpose

## Verification

After changes, verify with:

```bash
# Typecheck each package
pnpm run verify:workspace:tracked -- infra-claude
pnpm run verify:workspace:tracked -- infra-gpt
pnpm run verify:workspace:tracked -- infra-gemini
pnpm run verify:workspace:tracked -- infra-perplexity
pnpm run verify:workspace:tracked -- llm-contract
pnpm run verify:workspace:tracked -- llm-pricing
pnpm run verify:workspace:tracked -- llm-audit

# Full CI
pnpm run ci:tracked
```

## Files to Modify

| File                                      | Changes                   |
| ----------------------------------------- | ------------------------- |
| `packages/infra-claude/src/client.ts`     | Add comprehensive JSDoc   |
| `packages/infra-gpt/src/client.ts`        | Add comprehensive JSDoc   |
| `packages/infra-gemini/src/client.ts`     | Add comprehensive JSDoc   |
| `packages/infra-perplexity/src/client.ts` | Add comprehensive JSDoc   |
| `packages/llm-contract/src/types.ts`      | Add JSDoc to all types    |
| `packages/llm-pricing/src/usageLogger.ts` | Add JSDoc to functions    |
| `packages/llm-audit/src/audit.ts`         | Add JSDoc to AuditContext |
| `packages/infra-claude/README.md`         | **CREATE**                |
| `packages/infra-gpt/README.md`            | **CREATE**                |
| `packages/infra-gemini/README.md`         | **CREATE**                |
| `packages/infra-perplexity/README.md`     | **CREATE**                |
| `packages/llm-contract/README.md`         | **CREATE**                |
| `packages/llm-pricing/README.md`          | **CREATE**                |
| `packages/llm-audit/README.md`            | **CREATE**                |

## Not Doing (Deliberate Exclusions)

1. **TypeDoc setup** - Code comments matter more than generated docs
2. **Unified provider registry** - Current pattern is clear enough
3. **Streaming support** - Not needed for current use cases
4. **Tool calling framework** - Only using Claude web search directly
5. **Structured output helpers** - Manual JSON parsing is sufficient
