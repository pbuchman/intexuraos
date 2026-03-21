# @intexuraos/infra-otel

OpenTelemetry SDK bootstrap package for IntexuraOS services. Initializes distributed tracing and metrics export to Dash0 via OTLP HTTP, with auto-instrumentation for HTTP, Fastify, undici, DNS, and Net layers.

**Package:** `@intexuraos/infra-otel` | **Version:** 3.3.0 | **Type:** ESM | **Node:** >=22.0.0

---

## Overview

This package is a **side-effect bootstrap**: when loaded via `--import`, it reads configuration from environment variables and starts the OpenTelemetry Node SDK. If `INTEXURAOS_DASH0_OTLP_ENDPOINT` is not set, it does nothing — safe for local development and tests.

The package also exports `buildOtelConfig` and `getInstrumentations` as a library for use by `@intexuraos/infra-sentry`'s OTel log transport.

---

## Usage Pattern

The package is **not imported directly** in application code. It is loaded as a process-level side-effect via PM2's `NODE_OPTIONS`:

```
NODE_OPTIONS: '--import @intexuraos/infra-otel/register'
```

This is set in `ecosystem.config.cjs` and applies automatically to all 19 services managed by PM2. No code change is needed in individual services.

---

## API Reference

### `buildOtelConfig(): OtelConfig | undefined`

Reads configuration from environment variables. Returns `undefined` when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is not set, signalling the caller to skip OTel initialization.

```typescript
interface OtelConfig {
  readonly endpoint: string; // OTLP collector base URL
  readonly authToken: string; // Bearer auth token for Dash0 ('' if not set)
  readonly environment: string; // Deployment environment label (default: 'unknown')
}
```

### `getInstrumentations(): Instrumentation[]`

Returns the standard list of OpenTelemetry auto-instrumentations used across all services:

| Instrumentation                          | Instruments        |
| ---------------------------------------- | ------------------ |
| `@opentelemetry/instrumentation-http`    | Node.js http/https |
| `@opentelemetry/instrumentation-fastify` | Fastify routes     |
| `@opentelemetry/instrumentation-undici`  | undici HTTP client |
| `@opentelemetry/instrumentation-dns`     | DNS lookups        |
| `@opentelemetry/instrumentation-net`     | TCP connections    |

---

## Configuration

### Environment Variables

| Variable                         | Required | Description                                            |
| -------------------------------- | -------- | ------------------------------------------------------ |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT` | No       | OTLP collector URL. Omit to disable OTel entirely      |
| `INTEXURAOS_DASH0_AUTH_TOKEN`    | No       | Bearer token for Dash0 auth header                     |
| `INTEXURAOS_ENVIRONMENT`         | No       | Deployment environment tag (default: `unknown`)        |
| `OTEL_SERVICE_NAME`              | No       | Service name override (defaults to `npm_package_name`) |

### Resource Attributes

The SDK registers these attributes on all spans and metrics:

| OTel Attribute                | Source                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `service.name`                | `OTEL_SERVICE_NAME` → `npm_package_name` → `unknown-service` |
| `service.version`             | `npm_package_version` → `0.0.0`                              |
| `deployment.environment.name` | `INTEXURAOS_ENVIRONMENT` → `unknown`                         |

---

## Implementation Details

- **Trace export:** OTLP HTTP to `${endpoint}/v1/traces` with `Authorization: Bearer <token>` header
- **Metric export:** OTLP HTTP to `${endpoint}/v1/metrics` via `PeriodicExportingMetricReader` (30-second interval)
- **Graceful shutdown:** `sdk.shutdown()` called on `SIGTERM` (best-effort, errors swallowed)
- **Dual exports:** `"."` exports `buildOtelConfig`/`getInstrumentations` for library use; `"./register"` (build-only) is the side-effect entry point

---

## Dependencies

| Package                                     | Purpose                                     |
| ------------------------------------------- | ------------------------------------------- |
| `@opentelemetry/sdk-node`                   | Core Node.js OTel SDK                       |
| `@opentelemetry/exporter-trace-otlp-http`   | OTLP trace export over HTTP                 |
| `@opentelemetry/exporter-metrics-otlp-http` | OTLP metrics export over HTTP               |
| `@opentelemetry/resources`                  | Service resource definition                 |
| `@opentelemetry/semantic-conventions`       | Standard OTel attribute names               |
| `@opentelemetry/instrumentation-http`       | Auto-instrument Node.js http/https          |
| `@opentelemetry/instrumentation-fastify`    | Auto-instrument Fastify                     |
| `@opentelemetry/instrumentation-undici`     | Auto-instrument undici                      |
| `@opentelemetry/instrumentation-dns`        | Auto-instrument DNS                         |
| `@opentelemetry/instrumentation-net`        | Auto-instrument TCP                         |
| `@opentelemetry/sdk-metrics`                | Metrics SDK (PeriodicExportingMetricReader) |

---

## Used By

All 19 services use this package via `NODE_OPTIONS: '--import @intexuraos/infra-otel/register'` in `ecosystem.config.cjs`:

`actions-agent`, `api-docs-hub`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web-agent`, `whatsapp-service`

Additionally, `@intexuraos/infra-sentry` imports `buildOtelConfig` and `getInstrumentations` to configure its pino OTel log transport.

**Note on log forwarding:** Pino log forwarding to Dash0 is handled by `@intexuraos/infra-sentry` via `pino-opentelemetry-transport` (direct OTLP HTTP). The `PinoInstrumentation` auto-instrumentation was removed from this package because Node loader hooks conflict with tsx, preventing activation. Log transport configuration lives in `infra-sentry/src/otelTransport.ts`.

---

## File Structure

```
packages/infra-otel/
  src/
    index.ts              # Exports: buildOtelConfig, OtelConfig, getInstrumentations
    config.ts             # buildOtelConfig(): reads env vars, returns OtelConfig | undefined
    instrumentations.ts   # getInstrumentations(): returns OTel instrumentation array
    register.ts           # Side-effect: starts NodeSDK (compiled to dist/register.js only)
    __tests__/
      config.test.ts           # Unit tests for buildOtelConfig
      instrumentations.test.ts # Unit tests for getInstrumentations
      register.test.ts         # Tests for register module bootstrap
  package.json
  tsconfig.json
  tsconfig.build.json
```

**Note:** `register.ts` is only compiled to `dist/register.js` and is not re-exported from `"."`. Its body is covered by `/* v8 ignore start -- module-init */` since it requires a live OTel collector for integration testing.

---

## Recent Changes

| Commit     | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `0338e04f` | Remove PinoInstrumentation; move log forwarding to infra-sentry |
| `a49c3889` | Fix register export to point to compiled dist for --import      |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration (initial package creation)  |
