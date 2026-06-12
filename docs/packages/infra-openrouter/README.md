# @intexuraos/infra-openrouter

OpenAI-compatible client for the [OpenRouter](https://openrouter.ai) aggregator. Provides a single
`createOpenRouterClient(config)` factory that targets any model in the OpenRouter catalogue and
records usage via the shared `UsageSink` from `@intexuraos/llm-pricing`.

**Package:** `@intexuraos/infra-openrouter` | **Type:** ESM | **Node:** >=22.0.0

## Overview

OpenRouter exposes hundreds of frontier models from multiple providers (Anthropic, OpenAI,
Google, Mistral, etc.) under one OpenAI-compatible HTTP API. This package wraps that API for
use inside IntexuraOS:

- Strict per-model allowlist (`OPENROUTER_ALLOWED_MODELS`) so callers cannot accidentally route
  to an unbudgeted model.
- A separate "default-allowed" subset (`DEFAULT_OPENROUTER_ALLOWED_MODELS`) for code-task and
  research workflows that need a tight, vetted roster.
- Per-call cost calculation against the OpenRouter generation endpoint and emission to the
  workspace `UsageSink` (Firestore-backed via `@intexuraos/llm-pricing`).
- Web search (`:online` suffix) and JSON-mode passthrough.

## Exports

| Entry                 | Symbol                                                                                                                                                                            | Purpose                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `client.ts`           | `createOpenRouterClient`, `OpenRouterClient`                                                                                                                                      | Factory + client interface (`generate`, `research`).           |
| `allowlist.ts`        | `OPENROUTER_ALLOWED_MODELS`, `OPENROUTER_VALIDATION_MODEL`, `isAllowedModel`, `allowlistModelIds`, `buildModelInfo`                                                               | Strict allowlist for the full OpenRouter roster used in-prod.  |
| `defaultAllowlist.ts` | `DEFAULT_OPENROUTER_ALLOWED_MODELS`, `isDefaultAllowedModel`                                                                                                                      | Smaller default subset for general-purpose flows.              |
| `costCalculator.ts`   | `normalizeUsage`, `toModelPricing`                                                                                                                                                | Maps OpenRouter usage payloads to the workspace pricing types. |
| `types.ts`            | `GenerateOptions`, `OpenRouterConfig`, `OpenRouterError`, `OpenRouterModelInfo`, `OpenRouterKeyInfo`, `OpenRouterUsage`, `OpenRouterResponse`, `ResearchResult`, `GenerateResult` | Public types.                                                  |

## Usage

```ts
import { createOpenRouterClient } from '@intexuraos/infra-openrouter';

const client = createOpenRouterClient({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'anthropic/claude-sonnet-4.6',
  userId: 'user-123',
  logger: pinoLogger,
  usageSink: pricingService.sink('openrouter'),
});

const result = await client.generate({
  prompt: 'Summarize the contents of the attached document.',
  options: { responseFormat: { type: 'json_object' }, promptType: 'document-summary' },
});
```

## Environment

The package itself only consumes config passed to the factory. Apps that wire it up typically
read `INTEXURAOS_OPENROUTER_API_KEY` and forward it via `services.ts`. See
`docs/packages/llm-pricing/README.md` for the matching `UsageSink` setup.

## Build Output

This package follows the **source-exports default** — `package.json#exports` points at
`./src/index.ts`, no `dist/` is emitted. See
[`docs/architecture/package-build-output.md`](../../architecture/package-build-output.md).

## Testing

```bash
pnpm vitest run packages/infra-openrouter
```

Tests use `nock` to stub the OpenRouter HTTP API. No external network access is required.
