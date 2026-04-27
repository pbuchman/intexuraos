# @intexuraos/infra-gemini

Google Gemini API client with image-generation support, implementing `LLMClient`.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`, `@intexuraos/llm-prompts`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { GeminiClient } from '@intexuraos/infra-gemini';
```

For full API documentation, see [`docs/packages/infra-gemini/README.md`](../../docs/packages/infra-gemini/README.md).

## Tests

```bash
pnpm vitest run packages/infra-gemini
```
