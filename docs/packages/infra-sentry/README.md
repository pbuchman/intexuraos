# @intexuraos/infra-sentry

Sentry error tracking integration for IntexuraOS services. Provides SDK initialization, a Pino log stream that forwards errors/warnings to Sentry, a Fastify error handler, and a logger factory that wires everything together.

**Package:** `@intexuraos/infra-sentry` | **Version:** 3.3.0 | **Type:** ESM | **Node:** >=22.0.0

---

## Overview

This package solves a single problem: errors logged by services must reach Sentry without requiring each service to configure Sentry manually. It provides four layers:

1. **`initSentry()`** -- initialize the Sentry SDK at process startup
2. **`createSentryStream()`** -- a Pino multistream add-on that intercepts warn/error/fatal logs and sends them to Sentry
3. **`setupSentryErrorHandler()`** -- a Fastify error handler that captures unhandled route errors
4. **`createAppLogger()`** -- a factory that produces a Pino logger pre-wired with Sentry streaming (the recommended entry point for most apps)

All functions degrade gracefully when `INTEXURAOS_SENTRY_DSN` is not set.

---

## Quick Start

For most services, use `createAppLogger()` and `setupSentryErrorHandler()`:

```typescript
// index.ts
import { initSentry } from '@intexuraos/infra-sentry';

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'my-service',
});

// server.ts or services.ts
import { createAppLogger } from '@intexuraos/infra-sentry';

const logger = createAppLogger({ name: 'my-service' });
logger.info('Service starting');
logger.error({ err }, 'Something failed'); // automatically sent to Sentry
```

For Fastify apps, also register the error handler:

```typescript
import { setupSentryErrorHandler } from '@intexuraos/infra-sentry';

const app = Fastify({ logger: myLogger });
setupSentryErrorHandler(app);
```

---

## API Reference

### `initSentry(config: SentryConfig): void`

Initialize the Sentry SDK. Call this at the top of the service entry point (`index.ts`) before any other initialization. Returns early without error when DSN is missing or empty.

```typescript
interface SentryConfig {
  dsn?: string;
  environment?: string;
  serviceName: string;
  tracesSampleRate?: number; // default: 0 (tracing disabled)
}
```

Configuration details:

- `sendDefaultPii` is always `false`
- `serverName` maps to `serviceName` for Sentry dashboard filtering
- Omitting `dsn` disables Sentry entirely (safe for local development)

---

### `createAppLogger(config: AppLoggerConfig): Logger`

Create a Pino logger with automatic Sentry integration. This is the recommended way to create loggers in `apps/` code.

```typescript
interface AppLoggerConfig {
  name: string;
  level?: 'silent' | 'debug' | 'info' | 'warn' | 'error';
}
```

Behavior varies by environment:

| Condition                   | Logger Output                  |
| --------------------------- | ------------------------------ |
| `NODE_ENV=test`             | Silent logger (no output)      |
| No `INTEXURAOS_SENTRY_DSN`  | Plain Pino to stdout           |
| `INTEXURAOS_SENTRY_DSN` set | Pino to stdout + Sentry stream |

The logger uses `getLogLevel()` from `@intexuraos/common-core` by default, which respects `LOG_LEVEL` and `NODE_ENV` environment variables. An explicit `level` override takes precedence.

Error serializers are built in: `err` and `error` properties on log objects are automatically serialized (message, stack, code) via `serializeError` from `@intexuraos/common-core`.

---

### `createSentryStream(multistream): multistream`

Add a Sentry-forwarding stream to an existing Pino multistream. Use this when you need manual control over stream configuration (e.g., custom Fastify logger setup). For most cases, prefer `createAppLogger()`.

```typescript
import pino from 'pino';
import { createSentryStream } from '@intexuraos/infra-sentry';

const stream = createSentryStream(
  pino.multistream([
    pino.destination({ dest: 1, sync: false }), // stdout
  ])
);
```

The Sentry stream intercepts log entries at level 40+ (warn, error, fatal):

- **Warn (40):** sent as `Sentry.captureMessage` with level `warning`
- **Error (50):** sent as `Sentry.captureException` with level `error`
- **Fatal (60):** sent as `Sentry.captureException` with level `fatal`

If the log entry contains an `err` object with `stack` and/or `message` properties, those are attached to the captured Error.

Returns the multistream unchanged when `INTEXURAOS_SENTRY_DSN` is not set.

---

### `setupSentryErrorHandler(app: FastifyInstance): void`

Replace the default Fastify error handler with one that:

1. Logs the error via Pino (`request.log.error`)
2. Sends the error to Sentry with request context (URL, method, sanitized headers)
3. Returns a standardized error response using `reply.fail()`

Handles these special cases:

- `FST_ERR_CTP_INVALID_JSON_BODY` returns 400 with `INVALID_REQUEST`
- Validation errors (with `.validation` array) return 400 with field-level error details
- All other errors return 500 with `INTERNAL_ERROR`

Sensitive headers are redacted before sending to Sentry: `authorization`, `x-internal-auth`, `cookie`, `x-api-key`, `apikey`.

If Sentry itself fails, the error handler logs a warning and continues responding normally.

---

### `createLogStream(): ReturnType<typeof pino.multistream>`

Create the appropriate Pino log stream for the current environment. This is the recommended way to configure the Fastify logger stream in `server.ts`.

```typescript
import { createLogStream } from '@intexuraos/infra-sentry';

const app = Fastify({
  logger: {
    level: 'info',
    stream: createLogStream(),
  },
});
```

Behavior:

- **Development (`NODE_ENV=development`):** Formatted, colorized output via `createDevOutputStream`. Format: `HH:mm:ss | LEVEL | service-name | message | key=val pairs`
- **Production:** Raw JSON to stdout (`pino.destination` async, Cloud Logging compatible)
- **Both modes:** Sentry stream attached when `INTEXURAOS_SENTRY_DSN` is set
- **OTel transport:** `pino-opentelemetry-transport` stream added when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is set (routes logs to Dash0 via OTLP)

This function replaces the 3-line boilerplate previously required in every `server.ts`.

---

### `sendToSentry(level, message, context?): void`

Manually send an error or warning to Sentry outside of the automatic log integration.

```typescript
function sendToSentry(
  level: 'error' | 'warn',
  message: string,
  context?: Record<string, unknown>
): void;
```

Does nothing when `INTEXURAOS_SENTRY_DSN` is not set.

---

### `isSentryConfigured(): boolean`

Check whether `INTEXURAOS_SENTRY_DSN` is set and non-empty.

---

### `createSentryTransport(): undefined` (deprecated)

Legacy function that always returns `undefined`. Use `createSentryStream` instead. Kept for backward compatibility during migration.

---

## Dependencies

| Package                        | Role                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `@intexuraos/common-core`      | `getLogLevel`, `serializeError`, `Logger`              |
| `@sentry/node`                 | Sentry SDK (`init`, `captureException`, etc.)          |
| `fastify`                      | Type definitions for `FastifyInstance`, `FastifyError` |
| `pino`                         | Logger creation and multistream API                    |
| `pino-opentelemetry-transport` | Pino transport that forwards logs to Dash0 via OTLP    |

---

## Used By

19 apps import this package (all Fastify-based services):

| App                          | Usage                                            |
| ---------------------------- | ------------------------------------------------ |
| actions-agent                | `initSentry` + `createAppLogger` + error handler |
| api-docs-hub                 | `initSentry` + `createAppLogger`                 |
| app-settings-service         | `initSentry` + `createAppLogger` + error handler |
| bookmarks-agent              | `initSentry` + `createAppLogger` + error handler |
| calendar-agent               | `initSentry` + `createAppLogger` + error handler |
| chat-agent                   | `initSentry` + `createAppLogger` + error handler |
| code-agent                   | `initSentry` + `createAppLogger` + error handler |
| commands-agent               | `initSentry` + `createAppLogger` + error handler |
| data-insights-agent          | `initSentry` + `createAppLogger` + error handler |
| image-service                | `initSentry` + `createAppLogger` + error handler |
| linear-agent                 | `initSentry` + `createAppLogger` + error handler |
| mobile-notifications-service | `initSentry` + `createAppLogger` + error handler |
| notes-agent                  | `initSentry` + `createAppLogger` + error handler |
| notion-service               | `initSentry` + `createAppLogger` + error handler |
| research-agent               | `initSentry` + `createAppLogger` + error handler |
| todos-agent                  | `initSentry` + `createAppLogger` + error handler |
| user-service                 | `initSentry` + `createAppLogger` + error handler |
| web-agent                    | `initSentry` + `createAppLogger` + error handler |
| whatsapp-service             | `initSentry` + `createAppLogger` + error handler |

---

## Recent Changes

| Commit     | Description                                               |
| ---------- | --------------------------------------------------------- |
| `0338e04f` | Route pino logs to Dash0 via pino-opentelemetry-transport |
| `6063175b` | Add dev-mode log formatting for PM2 readability           |
| `f10ebdbf` | Fix empty error objects in log output                     |
| `44017d5c` | Fix ESLint OOM with batched parallel lint runner          |
| `dfd702f1` | Add Sentry-enabled logger factory and migrate all apps    |

---

## Environment Variables

| Variable                 | Required | Description                                    |
| ------------------------ | -------- | ---------------------------------------------- |
| `INTEXURAOS_SENTRY_DSN`  | No       | Sentry DSN. Omit to disable Sentry entirely    |
| `INTEXURAOS_ENVIRONMENT` | No       | Environment tag in Sentry (e.g., `production`) |
| `NODE_ENV`               | No       | `test` produces silent loggers                 |
| `LOG_LEVEL`              | No       | Override default log level                     |

---

## File Structure

```
packages/infra-sentry/
  src/
    index.ts                          # Package entry: re-exports all public API
    init.ts                           # initSentry(), SentryConfig
    transport.ts                      # createSentryStream(), sendToSentry(), isSentryConfigured(), createSentryTransport()
    transport-types.d.ts              # LogEvent, TransportDestination [unused, legacy]
    fastify.ts                        # setupSentryErrorHandler(), sanitizeHeaders()
    appLogger.ts                      # createAppLogger(), AppLoggerConfig
    logStream.ts                      # createLogStream() — unified stream factory
    devStream.ts                      # createDevOutputStream() — colorized dev-mode formatter
    otelTransport.ts                  # getOtelTransport() — pino-opentelemetry-transport singleton
    __tests__/
      init.test.ts                    # Tests for initSentry
      transport.test.ts               # Tests for stream and transport functions
      fastify.test.ts                 # Tests for Fastify error handler
      appLogger.test.ts               # Tests for createAppLogger
      logStream.test.ts               # Tests for createLogStream
      devStream.test.ts               # Tests for createDevOutputStream
      otelTransport.test.ts           # Tests for getOtelTransport singleton
  package.json
  tsconfig.json
```
