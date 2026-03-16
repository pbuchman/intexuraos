# Agent Reference: @intexuraos/infra-otel

## Package Metadata

```yaml
name: '@intexuraos/infra-otel'
version: '3.3.0'
entry:
  '.': './src/index.ts'
  './register': './dist/register.js'
type: 'module'
private: true
engines:
  node: '>=22.0.0'
```

---

## Exports

```typescript
// index.ts (entry ".")
export function buildOtelConfig(): OtelConfig | undefined;
export function getInstrumentations(): Instrumentation[];
export type { OtelConfig };

// ./register (side-effect, build-only — NOT re-exported from ".")
// Auto-runs on import: starts NodeSDK when INTEXURAOS_DASH0_OTLP_ENDPOINT is set
```

---

## Key Types

```typescript
interface OtelConfig {
  readonly endpoint: string; // OTLP base URL (e.g. https://ingress.eu1.dash0.com)
  readonly authToken: string; // Bearer token (empty string when not configured)
  readonly environment: string; // Deployment env label (default: 'unknown')
}
```

---

## Usage Patterns

### Side-effect (all apps via PM2)

```
# ecosystem.config.cjs — applies globally to all 19 services
NODE_OPTIONS: '--import @intexuraos/infra-otel/register'
```

The `./register` entry point is a Node.js `--import` startup hook. It must **not** be imported in application source code.

### Library usage (infra-sentry otelTransport)

```typescript
import { buildOtelConfig, getInstrumentations } from '@intexuraos/infra-otel';

const config = buildOtelConfig(); // undefined → no OTel endpoint configured
if (config !== undefined) {
  // use config.endpoint, config.authToken, config.environment
}

const instrumentations = getInstrumentations();
// Returns: [HttpInstrumentation, FastifyInstrumentation, UndiciInstrumentation, DnsInstrumentation, NetInstrumentation]
```

---

## Environment Variables

| Variable                         | Read By             | Required    |
| -------------------------------- | ------------------- | ----------- |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT` | `buildOtelConfig()` | No          |
| `INTEXURAOS_DASH0_AUTH_TOKEN`    | `buildOtelConfig()` | No          |
| `INTEXURAOS_ENVIRONMENT`         | `buildOtelConfig()` | No          |
| `OTEL_SERVICE_NAME`              | `register.ts`       | No          |
| `npm_package_name`               | `register.ts`       | Auto (Node) |
| `npm_package_version`            | `register.ts`       | Auto (Node) |

---

## Instrumentations

| Name                                     | Class                    |
| ---------------------------------------- | ------------------------ |
| `@opentelemetry/instrumentation-http`    | `HttpInstrumentation`    |
| `@opentelemetry/instrumentation-fastify` | `FastifyInstrumentation` |
| `@opentelemetry/instrumentation-undici`  | `UndiciInstrumentation`  |
| `@opentelemetry/instrumentation-dns`     | `DnsInstrumentation`     |
| `@opentelemetry/instrumentation-net`     | `NetInstrumentation`     |

**Note:** `PinoInstrumentation` was removed (commit `0338e04f`). Pino log forwarding is handled by `@intexuraos/infra-sentry` via `pino-opentelemetry-transport` (direct OTLP HTTP) because Node loader hooks conflict with tsx.

---

## Register Module Behaviour

```typescript
// register.ts — loads via: node --import @intexuraos/infra-otel/register

const config = buildOtelConfig(); // undefined → skip everything

if (config !== undefined) {
  const headers = config.authToken !== '' ? { Authorization: `Bearer ${authToken}` } : {};

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME ?? npm_package_name ?? 'unknown-service',
      [ATTR_SERVICE_VERSION]: npm_package_version ?? '0.0.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
      exportIntervalMillis: 30_000,
    }),
    instrumentations: getInstrumentations(),
  });

  sdk.start();
  process.on('SIGTERM', () =>
    sdk.shutdown().catch(() => {
      /* best-effort */
    })
  );
}

// v8 ignore: module-init — requires live collector for integration testing
```

---

## Consumer Apps

All 19 apps consume this via side-effect (`ecosystem.config.cjs`):

```
actions-agent, api-docs-hub, app-settings-service, bookmarks-agent,
calendar-agent, chat-agent, code-agent, commands-agent,
data-insights-agent, image-service, linear-agent,
mobile-notifications-service, notes-agent, notion-service,
research-agent, todos-agent, user-service, web-agent, whatsapp-service
```

`@intexuraos/infra-sentry` also depends on this package directly (library use).

---

## File Map

```
src/index.ts            -> exports buildOtelConfig, OtelConfig, getInstrumentations
src/config.ts           -> buildOtelConfig(), OtelConfig interface
src/instrumentations.ts -> getInstrumentations()
src/register.ts         -> side-effect SDK bootstrap (compiled to dist/register.js only)
src/__tests__/config.test.ts            -> tests for buildOtelConfig
src/__tests__/instrumentations.test.ts  -> tests for getInstrumentations
src/__tests__/register.test.ts          -> tests for register bootstrap
```
