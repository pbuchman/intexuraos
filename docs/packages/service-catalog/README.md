# @intexuraos/service-catalog

Canonical registry of IntexuraOS internal HTTP services and their environment-variable bindings, used to compose service URLs and OpenAPI document sources.

**Package:** `@intexuraos/service-catalog` | **Type:** ESM | **Node:** >=22.0.0

## Overview

Internal service-to-service traffic in IntexuraOS goes over HTTPS to Cloud Run URLs that are discovered at runtime through `INTEXURAOS_<SERVICE>_URL` environment variables. To avoid each consumer hard-coding service names and env-var prefixes, this package provides:

- `INTERNAL_API_SERVICE_CATALOG` — the canonical list of `(name, envVarSuffix)` entries for every internal Fastify app.
- Helpers (`buildInternalApiServiceDefinitions`, `buildInternalApiOpenApiSources`) that read the matching env vars and yield ready-to-use service definitions or OpenAPI document sources.

The catalogue is consumed by the OpenAPI aggregator (`/internal/openapi`), the inter-service HTTP clients in `@intexuraos/internal-clients`, and CI lockstep checks that ensure new services get wired into Terraform and the web bundle.

## Exports

| Symbol                                | Source file                  | Purpose                                                                                                         |
| ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `INTERNAL_API_SERVICE_CATALOG`        | `internalServiceCatalog.ts`  | Readonly array of `InternalApiServiceCatalogEntry` describing every internal Fastify service.                   |
| `INTERNAL_API_BASE_URL_ENV_VARS`      | `internalServiceCatalog.ts`  | Tuple of all `INTEXURAOS_<SERVICE>_URL` env-var names derived from the catalogue.                               |
| `INTERNAL_API_OPENAPI_URL_ENV_VARS`   | `internalServiceCatalog.ts`  | Tuple of all `INTEXURAOS_<SERVICE>_OPENAPI_URL` overrides (optional per-service).                               |
| `buildInternalApiServiceDefinitions`  | `internalServiceCatalog.ts`  | Reads the env vars and returns `InternalApiServiceDefinition[]` for every catalogue entry that is configured.   |
| `buildInternalApiOpenApiSources`      | `internalServiceCatalog.ts`  | Returns `InternalApiOpenApiSource[]` (URL or HTTP loader pair) for the OpenAPI aggregator.                      |
| `InternalApiServiceCatalogEntry`      | `internalServiceCatalog.ts`  | Type: `{ name: string; envVarSuffix: string }`.                                                                 |
| `InternalApiServiceDefinition`        | `internalServiceCatalog.ts`  | Type: resolved service entry with `baseUrl` and metadata.                                                       |
| `InternalApiOpenApiSource`            | `internalServiceCatalog.ts`  | Type: source descriptor consumed by the OpenAPI aggregator.                                                     |

## Usage

```ts
import {
  INTERNAL_API_SERVICE_CATALOG,
  buildInternalApiServiceDefinitions,
} from '@intexuraos/service-catalog';

// Validate that every service in the catalogue has a wired URL env var:
const services = buildInternalApiServiceDefinitions(process.env);

for (const service of services) {
  console.log(`${service.name} -> ${service.baseUrl}`);
}
```

## Build Output

This package follows the **source-exports default** — `package.json#exports` points at `./src/index.ts`, no `dist/` is emitted. See [`docs/architecture/package-build-output.md`](../../architecture/package-build-output.md).

## Testing

```bash
pnpm vitest run packages/service-catalog
```

Tests cover catalogue completeness, env-var derivation, and the helpers' behaviour when env vars are missing or malformed.
