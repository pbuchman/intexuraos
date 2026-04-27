# @intexuraos/infra-perplexity

Perplexity AI API client with SSE streaming support, implementing `LLMClient`.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`, `@intexuraos/llm-prompts`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { PerplexityClient } from '@intexuraos/infra-perplexity';
```

For full API documentation, see [`docs/packages/infra-perplexity/README.md`](../../docs/packages/infra-perplexity/README.md).

## Tests

```bash
pnpm vitest run packages/infra-perplexity
```
