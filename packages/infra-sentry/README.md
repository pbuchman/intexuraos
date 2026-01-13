# @intexuraos/infra-sentry

Sentry error tracking integration for IntexuraOS services. Captures all `log.error()` and `log.warn()` calls automatically via Pino transport.

## Installation

This is an internal package - installed via workspace protocol.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INTEXURAOS_SENTRY_DSN` | No | Sentry DSN for error tracking |
| `INTEXURAOS_ENVIRONMENT` | No | Environment name (defaults to 'development') |

## Usage

### 1. Initialize Sentry in `src/index.ts`

```typescript
import { initSentry } from '@intexuraos/infra-sentry';

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'my-service',
});

// Rest of imports and initialization...
```

### 2. Add Pino Transport in `src/server.ts`

```typescript
import { createSentryTransport, setupSentryErrorHandler } from '@intexuraos/infra-sentry';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env['NODE_ENV'] === 'test' ? false : {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport: createSentryTransport(), // ← Add this
    },
    disableRequestLogging: true,
  });

  // Replace existing error handler
  setupSentryErrorHandler(app); // ← Add this

  // ... rest of server setup
}
```

### 3. No Changes to Existing Logging

All existing `log.error()` and `log.warn()` calls are automatically sent to Sentry:

```typescript
// These are now captured by Sentry
log.error({ userId, error: getErrorMessage(err) }, 'Failed to process request');
log.warn({ missingProviders }, 'Missing pricing for providers');
```

## API

### `initSentry(config)`

Initialize Sentry SDK. Call at the top of `index.ts` before other imports.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| dsn | string | No | Sentry DSN (from env var) |
| environment | string | No | Environment name |
| serviceName | string | Yes | Service identifier for Sentry |
| tracesSampleRate | number | No | Tracing sample rate (default: 0) |

### `createSentryTransport()`

Creates a Pino transport that sends errors/warnings to Sentry. Returns `undefined` if DSN is not set.

### `setupSentryErrorHandler(app)`

Replaces Fastify error handler with one that sends unhandled errors to Sentry.

| Parameter | Type | Description |
|-----------|------|-------------|
| app | FastifyInstance | Fastify app instance |

## Features

- **Non-breaking**: Works normally if DSN is not configured
- **Automatic**: No changes to existing logging code
- **Structured data**: Full log context sent to Sentry
- **Header redaction**: Sensitive headers automatically redacted
- **Validation errors**: Standardized error responses maintained
