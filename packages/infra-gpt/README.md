# @intexuraos/infra-gpt

OpenAI GPT API client with image-generation support, implementing `LLMClient`.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`, `@intexuraos/llm-prompts`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { GptClient } from '@intexuraos/infra-gpt';
```

For full API documentation, see [`docs/packages/infra-gpt/README.md`](../../docs/packages/infra-gpt/README.md).

## Tests

```bash
pnpm vitest run packages/infra-gpt
```
