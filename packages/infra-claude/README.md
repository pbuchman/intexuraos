# @intexuraos/infra-claude

Anthropic Claude AI client implementation for IntexuraOS, implementing `LLMClient`.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`, `@intexuraos/llm-prompts`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { ClaudeClient } from '@intexuraos/infra-claude';
```

For full API documentation, see [`docs/packages/infra-claude/README.md`](../../docs/packages/infra-claude/README.md).

## Tests

```bash
pnpm vitest run packages/infra-claude
```
