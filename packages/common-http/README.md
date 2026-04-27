# @intexuraos/common-http

Fastify plugins, JWT auth helpers, and standard API response/redaction utilities.

## Contract

- **Layer:** http-utility
- **Dependencies:** `@intexuraos/common-core`, `@intexuraos/llm-utils`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { jsonError, redactPayload } from '@intexuraos/common-http';
```

For full API documentation, see [`docs/packages/common-http/README.md`](../../docs/packages/common-http/README.md).

## Tests

```bash
pnpm vitest run packages/common-http
```
