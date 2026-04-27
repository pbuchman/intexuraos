# @intexuraos/llm-prompts

Centralized library of typed `PromptBuilder` prompts with Zod response schemas, used across IntexuraOS services.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/llm-contract`, `@intexuraos/llm-utils`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { PromptBuilder } from '@intexuraos/llm-prompts';
```

For full API documentation, see [`docs/packages/llm-prompts/README.md`](../../docs/packages/llm-prompts/README.md).

## Tests

```bash
pnpm vitest run packages/llm-prompts
```
