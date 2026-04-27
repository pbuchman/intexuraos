# @intexuraos/llm-pricing

Fetches LLM pricing from app-settings-service and tracks per-call usage to Firestore.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-firestore`, `@intexuraos/llm-contract`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { LLMPricingService } from '@intexuraos/llm-pricing';
```

For full API documentation, see [`docs/packages/llm-pricing/README.md`](../../docs/packages/llm-pricing/README.md).

## Tests

```bash
pnpm vitest run packages/llm-pricing
```
