# Dash0 OpenTelemetry Integration Design

**Date:** 2026-02-16
**Status:** Approved
**Goal:** Full OpenTelemetry integration sending traces, metrics, and logs to Dash0 for all services in both dev (PM2) and prod (Cloud Run) environments.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Service (Fastify)                                       │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ OTel SDK     │  │ Pino Logger   │  │ Sentry       │  │
│  │ (preloaded)  │  │ (unchanged)   │  │ (unchanged)  │  │
│  └──────┬───────┘  └───────┬───────┘  └──────┬───────┘  │
│         │                  │                  │          │
│  Auto-instruments:         │                  │          │
│  - HTTP/undici             │                  │          │
│  - Fastify                 │                  │          │
│  - Pino (logs→OTel)        │                  │          │
│  - dns, net                │                  │          │
└─────────┼──────────────────┼──────────────────┼──────────┘
          │                  │                  │
          ▼                  ▼                  ▼
   ┌──────────────┐   ┌───────────┐     ┌───────────┐
   │ Dash0        │   │ stdout    │     │ Sentry.io │
   │ (OTLP/HTTP)  │   │ (Cloud    │     │ (errors)  │
   │              │   │  Logging) │     │           │
   │ Traces       │   └───────────┘     └───────────┘
   │ Metrics      │
   │ Logs         │
   └──────────────┘
```

**Key decisions:**

- OTel loaded via `--import` flag as preload module (zero app code changes)
- Auto-instrumentation patches Fastify, HTTP, Pino before they're imported
- No-op when Dash0 env vars absent (CI, tests, local without Dash0)
- Sentry stays for error tracking
- Cloud Logging stays (Pino stdout unchanged)
- Dash0 replaces GCP monitoring dashboard, metrics, and alerts (follow-up task)

---

## New Package: `packages/infra-otel`

### Structure

```
packages/infra-otel/
  src/
    register.ts         # Preload module (--import target)
    config.ts           # Reads env vars, builds OTel config
    instrumentations.ts # Auto-instrumentation list
  package.json
  tsconfig.json
  vitest.config.ts
```

### Auto-instrumentations

| Package                                     | What it captures                            |
| ------------------------------------------- | ------------------------------------------- |
| `@opentelemetry/instrumentation-http`       | All HTTP client/server spans                |
| `@opentelemetry/instrumentation-fastify`    | Route-level spans with path/method          |
| `@opentelemetry/instrumentation-pino`       | Injects trace_id/span_id into log records   |
| `@opentelemetry/instrumentation-undici`     | Outbound fetch() calls (service-to-service) |
| `@opentelemetry/instrumentation-dns`        | DNS resolution timing                       |
| `@opentelemetry/instrumentation-net`        | TCP connection timing                       |

### Environment Variables

| Variable                           | Purpose                        | Example                        |
| ---------------------------------- | ------------------------------ | ------------------------------ |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT`  | Dash0 OTLP HTTP endpoint      | `https://ingress.eu1.dash0.com` |
| `INTEXURAOS_DASH0_AUTH_TOKEN`      | Dash0 API auth token           | `dash0-auth-...`               |
| `INTEXURAOS_ENVIRONMENT`           | Reused for deployment.environment | `dev` / `production`        |

No-op behavior: if `INTEXURAOS_DASH0_OTLP_ENDPOINT` is undefined, the register module exits immediately.

---

## Build Pipeline Changes

### `scripts/build-service.mjs`

Add a second esbuild entry point for the OTel preload:

- `dist/index.js` — the service (existing)
- `dist/otel-register.js` — the OTel preload (new, bundled from `packages/infra-otel/src/register.ts`)

The `collectExternalDepsWithVersions` function already recurses into workspace packages, so `@opentelemetry/*` npm dependencies from `infra-otel` will be included in `dist/package.json` automatically.

### All 19 Dockerfiles

```dockerfile
# Before:
CMD ["node", "dist/index.js"]

# After:
COPY --from=builder /app/apps/<service>/dist/otel-register.js ./dist/
CMD ["node", "--import", "./dist/otel-register.js", "dist/index.js"]
```

---

## Infrastructure (Terraform)

### New Secrets in Secret Manager

| Secret Name                        | Value                     |
| ---------------------------------- | ------------------------- |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT`  | Dash0 OTLP ingress URL   |
| `INTEXURAOS_DASH0_AUTH_TOKEN`      | Dash0 Bearer auth token   |

### Terraform Changes (`terraform/environments/dev/main.tf`)

1. Add 2 secrets to secret manager module
2. Add to `local.common_service_secrets` (propagates to all 19 services automatically)

### Secret Population

```bash
echo -n "<endpoint>" | gcloud secrets versions add INTEXURAOS_DASH0_OTLP_ENDPOINT --data-file=-
echo -n "<token>" | gcloud secrets versions add INTEXURAOS_DASH0_AUTH_TOKEN --data-file=-
```

### Terraform Apply

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform plan && terraform apply
```

---

## Dev Environment (PM2)

### `ecosystem.config.cjs`

Add to `COMMON_SERVICE_ENV`:

```javascript
INTEXURAOS_DASH0_OTLP_ENDPOINT: process.env.INTEXURAOS_DASH0_OTLP_ENDPOINT,
INTEXURAOS_DASH0_AUTH_TOKEN: process.env.INTEXURAOS_DASH0_AUTH_TOKEN,
```

Add `NODE_OPTIONS` to inject the preload:

```javascript
NODE_OPTIONS: '--import @intexuraos/infra-otel/dist/register.js',
```

### `.envrc`

```bash
export INTEXURAOS_DASH0_OTLP_ENDPOINT="https://ingress.eu1.dash0.com"
export INTEXURAOS_DASH0_AUTH_TOKEN="<token>"
```

---

## Dash0 Account Setup (Manual)

1. Sign up at dash0.com
2. Create organization "IntexuraOS"
3. Get OTLP endpoint + auth token from Integrations Hub
4. Store in GCP Secret Manager and `.envrc`
5. Post-deploy: create dashboards, alerts, log views

---

## What Stays Unchanged

| Component            | Status    |
| -------------------- | --------- |
| Sentry (infra-sentry) | Unchanged |
| Pino logging         | Unchanged |
| Cloud Logging        | Unchanged |
| Application code     | Unchanged |
| Existing tests       | Unchanged |

---

## Testing

- Unit tests for `infra-otel` (config parsing, no-op path) — 95% branch coverage
- Register module's "start SDK" branch: `/* v8 ignore module-init */` exemption
- Integration verification: deploy to dev, hit endpoints, check Dash0 dashboard
- No changes to existing test suites

---

## Follow-up Tasks (Not in Scope)

- Remove GCP monitoring dashboard/metrics/alerts (after Dash0 verified)
- Dash0 dashboard design and alert rule configuration
