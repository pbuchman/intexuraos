# @intexuraos/llm-factory

Unified factory for creating LLM clients across different providers, mapping model names to provider-specific clients.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-gemini`, `@intexuraos/infra-openrouter`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { createLLMClient } from '@intexuraos/llm-factory';
```

For full API documentation, see [`docs/packages/llm-factory/README.md`](../../docs/packages/llm-factory/README.md).

## Tests

```bash
pnpm vitest run packages/llm-factory
```
