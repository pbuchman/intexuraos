# @intexuraos/internal-clients

Typed HTTP clients for calling IntexuraOS internal service APIs (`/internal/*` endpoints with `X-Internal-Auth`).

## Contract

- **Layer:** integration
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-openrouter`, `@intexuraos/llm-contract`, `@intexuraos/llm-factory`, `@intexuraos/llm-pricing`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { createInternalClient } from '@intexuraos/internal-clients';
```

For full API documentation, see [`docs/packages/internal-clients/README.md`](../../docs/packages/internal-clients/README.md).

## Tests

```bash
pnpm vitest run packages/internal-clients
```
