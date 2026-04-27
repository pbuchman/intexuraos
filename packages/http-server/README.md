# @intexuraos/http-server

Reusable Fastify health-check routes and validation error handler used by every IntexuraOS service.

## Contract

- **Layer:** http-utility
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/common-http`, `@intexuraos/infra-firestore`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { registerHealthRoutes, validationErrorHandler } from '@intexuraos/http-server';
```

For full API documentation, see [`docs/packages/http-server/README.md`](../../docs/packages/http-server/README.md).

## Tests

```bash
pnpm vitest run packages/http-server
```
