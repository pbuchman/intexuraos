# infra-sentry — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 documentation run](../../documentation-runs.md)

---

## Current State

The package is at v3.3.0. It reached its current architecture after a major refactoring (v2.0.0) that replaced the worker-thread-based Pino transport with an in-process stream approach compatible with esbuild bundling. The `createAppLogger()` factory was added in `dfd702f1` and all 19 apps have been migrated to use it.

`devStream.ts` provides ANSI-colorized log formatting for PM2/dev environments, and `otelTransport.ts` routes logs to Dash0 via `pino-opentelemetry-transport`.

---

## Known Issues

### 1. Deprecated `createSentryTransport()` still exported

The function always returns `undefined` and exists only for backward compatibility. No callers remain in the codebase after the v2.0.0 migration. Removing it would clean up the public API.

**Impact:** Low. No runtime effect.

### 2. `transport-types.d.ts` is unused

The `LogEvent` and `TransportDestination` interfaces defined in `transport-types.d.ts` are not imported by any source file. They were part of the old worker-thread transport approach. The current stream-based implementation uses `LogDescriptor` from Pino directly.

**Impact:** Low. Dead code.

### 3. Multistream internal structure casting

`createSentryStream()` casts the Pino multistream to access its internal `streams` array:

```typescript
const ms = multistream as unknown as {
  streams: { level: number; stream: NodeJS.WritableStream }[];
};
```

This depends on an undocumented Pino internal. A Pino major version bump could break this pattern.

**Impact:** Medium. Breakage would be caught by tests, but the fix might require a different approach.

### 4. OTel transport singleton uses `process.env` mutation

`otelTransport.ts` directly sets `process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']` and `process.env['OTEL_EXPORTER_OTLP_LOGS_HEADERS']` before starting the pino transport worker thread. This is necessary because the worker thread receives these env vars from the parent process, but it is a side effect with global scope.

**Impact:** Low. Only runs once (singleton guard), and only when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is set. The `_resetOtelTransport()` internal function clears state for tests.

**Recommendation:** Document the env var mutation explicitly so future maintainers understand why it is necessary.

---

### 5. No Sentry flush on process exit

The package does not call `Sentry.close()` or `Sentry.flush()` during graceful shutdown. Events buffered in-memory at shutdown time may be lost.

**Impact:** Medium in production. The last few error events before a crash or scale-to-zero could be silently dropped.

### 6. `sanitizeHeaders` is not exported

The header sanitization function in `fastify.ts` is private. Other packages or middleware that need consistent header redaction cannot reuse it.

**Impact:** Low. Could lead to inconsistent redaction if other modules implement their own.

### 7. Sentry scope in stream does not set tags

The stream-based `sendLogToSentry` function calls `scope.setExtras()` for structured context but does not set Sentry tags (like `service`, `userId`). The Fastify error handler does set tags. This inconsistency means logs captured via the stream have less structured metadata in Sentry.

**Impact:** Low. Affects Sentry dashboard filtering but not error capture.

---

## Future Plans

| Area                   | Description                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Remove deprecated API  | Delete `createSentryTransport()` and `transport-types.d.ts`                         |
| Add Sentry flush hook  | Integrate `Sentry.close()` into Fastify `onClose` hook                              |
| Structured tags        | Extract common fields (`userId`, `traceId`, `service`) as Sentry tags in the stream |
| Source maps            | Upload source maps during CI/CD for readable stack traces                           |
| Performance monitoring | Enable `tracesSampleRate > 0` for selected services                                 |

---

## Code Quality Notes

- All Sentry operations are wrapped in try/catch to prevent error tracking from breaking application error handling
- The `createAppLogger` factory produces silent loggers in test environments to prevent noisy test output
- Error serializers (`err`, `error`) ensure Error objects are properly serialized regardless of how they are passed to the logger
- Header sanitization covers 5 sensitive header patterns: `authorization`, `x-internal-auth`, `cookie`, `x-api-key`, `apikey`
