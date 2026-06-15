# @intexuraos/infra-sentry

Sentry error tracking integration for IntexuraOS services, capturing all `log.error()` and `log.warn()` calls automatically via Pino transport. Provides the shared `createAppLogger()` factory.

## Contract

- **Layer:** infra-wrapper
- **Dependencies:** `@intexuraos/common-core`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { createAppLogger, initSentry } from '@intexuraos/infra-sentry';
```

For full API documentation, see [`docs/packages/infra-sentry/README.md`](../../docs/packages/infra-sentry/README.md).

## Tests

```bash
pnpm vitest run packages/infra-sentry
```
