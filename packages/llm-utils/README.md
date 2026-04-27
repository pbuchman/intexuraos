# @intexuraos/llm-utils

Sensitive-data redaction utilities and structured LLM parse-error helpers for IntexuraOS services.

## Contract

- **Layer:** llm
- **Dependencies:** `@intexuraos/common-core`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { redactSensitive, parseLLMResponse } from '@intexuraos/llm-utils';
```

For full API documentation, see [`docs/packages/llm-utils/README.md`](../../docs/packages/llm-utils/README.md).

## Tests

```bash
pnpm vitest run packages/llm-utils
```
