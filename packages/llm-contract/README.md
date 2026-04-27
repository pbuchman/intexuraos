# @intexuraos/llm-contract

Common types and interfaces for LLM client implementations (model names, message shapes, `LLMClient` contract).

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import type { LLMClient, ModelName } from '@intexuraos/llm-contract';
```

For full API documentation, see [`docs/packages/llm-contract/README.md`](../../docs/packages/llm-contract/README.md).

## Tests

```bash
pnpm vitest run packages/llm-contract
```
