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

Structured logs can explicitly supply `_sentryTags` for payload-free diagnostic
strings. The transport accepts at most 16 tags, with keys matching
`[a-z][a-z0-9_.-]{0,63}` and values up to 200 characters. It sends these as Sentry
tags rather than extras, so SentryBox retains them. Callers must never include
credentials, queries, user payloads, or raw API responses in tag values.
