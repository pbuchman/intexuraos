# infra-sentry -- Agent Reference

Machine-readable export and interface reference for `@intexuraos/infra-sentry`.

---

## Package Metadata

```yaml
name: "@intexuraos/infra-sentry"
version: "2.1.0"
entry: "./src/index.ts"
type: "module"
private: true
engines:
  node: ">=22.0.0"
```

---

## Exports

### Functions

```typescript
function initSentry(config: SentryConfig): void;

function createAppLogger(config: AppLoggerConfig): Logger;

function createSentryStream(
  multistream: ReturnType<typeof import('pino').multistream>
): ReturnType<typeof import('pino').multistream>;

function setupSentryErrorHandler(app: FastifyInstance): void;

function sendToSentry(
  level: 'error' | 'warn',
  message: string,
  context?: Record<string, unknown>
): void;

function isSentryConfigured(): boolean;

/** @deprecated Use createSentryStream instead. */
function createSentryTransport(): undefined;
```

### Interfaces

```typescript
interface SentryConfig {
  dsn?: string;
  environment?: string;
  serviceName: string;
  tracesSampleRate?: number;
}

interface AppLoggerConfig {
  name: string;
  level?: 'silent' | 'debug' | 'info' | 'warn' | 'error';
}
```

### Internal-Only Interfaces (transport-types.d.ts, not exported)

```typescript
interface LogEvent {
  msg?: string;
  err?: unknown;
  level: number;
  time: number;
  [key: string]: unknown;
}

interface TransportDestination {
  level: string;
  send(level: string, logEvent: LogEvent): void;
}
```

### Internal-Only Interfaces (fastify.ts, not exported)

```typescript
interface IntexuraFastifyReply extends FastifyReply {
  fail: (code: string, message: string, diagnostics?: unknown, details?: unknown) => FastifyReply;
}
```

---

## Environment Variables Read

| Variable                 | Read By                                  | Required |
| ------------------------ | ---------------------------------------- | -------- |
| `INTEXURAOS_SENTRY_DSN`  | `isSentryConfigured()`, `sendToSentry()` | No       |
| `NODE_ENV`               | `createAppLogger()`                      | No       |
| `LOG_LEVEL`              | Via `getLogLevel()` from common-core     | No       |

---

## Pino Log Levels Forwarded to Sentry

| Pino Level | Numeric | Sentry Level | Sentry Method        |
| ---------- | ------- | ------------ | -------------------- |
| warn       | 40      | warning      | `captureMessage`     |
| error      | 50      | error        | `captureException`   |
| fatal      | 60      | fatal        | `captureException`   |

---

## Sensitive Headers Redacted

```
authorization, x-internal-auth, cookie, x-api-key, apikey
```

---

## Dependency Graph

```
@intexuraos/infra-sentry
  +-- @intexuraos/common-core    (getLogLevel, serializeError)
  +-- @sentry/node               (init, captureException, captureMessage, withScope)
  +-- fastify                    (FastifyInstance, FastifyError, FastifyReply)
  +-- pino                       (Logger, multistream, destination, LogDescriptor)
```

---

## Consumer Apps

```
actions-agent, api-docs-hub, app-settings-service, bookmarks-agent,
calendar-agent, chat-agent, code-agent, commands-agent,
data-insights-agent, image-service, linear-agent,
mobile-notifications-service, notes-agent, notion-service,
research-agent, todos-agent, user-service, web-agent, whatsapp-service
```

---

## Typical Integration Pattern

```
index.ts:    initSentry({ dsn, environment, serviceName })
services.ts: createAppLogger({ name: serviceName })
server.ts:   setupSentryErrorHandler(app)
```

---

## File Map

```
src/index.ts              -> re-exports initSentry, SentryConfig, createSentryStream, sendToSentry, isSentryConfigured, setupSentryErrorHandler, createAppLogger, AppLoggerConfig
src/init.ts               -> initSentry(), SentryConfig
src/transport.ts          -> createSentryStream(), sendToSentry(), isSentryConfigured(), createSentryTransport() [deprecated], sendLogToSentry() [internal]
src/transport-types.d.ts  -> LogEvent, TransportDestination [unused]
src/fastify.ts            -> setupSentryErrorHandler(), IntexuraFastifyReply [internal], sanitizeHeaders() [internal]
src/appLogger.ts          -> createAppLogger(), AppLoggerConfig, errorSerializers [internal]
```
