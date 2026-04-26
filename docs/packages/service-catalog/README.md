# @intexuraos/service-catalog

Canonical registry of IntexuraOS internal HTTP services and their environment-variable bindings. Centralizes the mapping between a service name and its base URL / OpenAPI URL so that internal clients, OpenAPI aggregation, and Terraform wiring stay in lockstep.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf package)

## Exports

| Entry Point | Path        | Contents                                                                          |
| ----------- | ----------- | --------------------------------------------------------------------------------- |
| Main        | `.` (index) | Service catalog constant + URL/OpenAPI source builders + supporting type aliases  |

## API Reference

### Catalog (`internalServiceCatalog.ts`)

```typescript
const INTERNAL_API_SERVICE_CATALOG: readonly InternalApiServiceCatalogEntry[];
const INTERNAL_API_BASE_URL_ENV_VARS: readonly string[];
const INTERNAL_API_OPENAPI_URL_ENV_VARS: readonly string[];

type InternalApiServiceCatalogEntry = {
  readonly name: string;
  readonly baseUrlEnvVar: string;
  readonly openApiUrlEnvVar?: string;
};
```

Source of truth for which Cloud Run services exist and which env var carries each one's base URL (e.g. `INTEXURAOS_CHAT_AGENT_URL`). Consumed by:

- `@intexuraos/internal-clients` to build typed HTTP clients without hardcoded URLs.
- The `apps/web` build pipeline to fetch Cloud Run URLs at deploy time.
- OpenAPI aggregation to discover which services to merge specs from.

### Builders

```typescript
function buildInternalApiServiceDefinitions(
  env: NodeJS.ProcessEnv,
): InternalApiServiceDefinition[];

function buildInternalApiOpenApiSources(
  env: NodeJS.ProcessEnv,
): InternalApiOpenApiSource[];
```

Project the catalog onto a concrete environment, returning only the entries whose env vars are set. `buildInternalApiServiceDefinitions` resolves base URLs for typed clients; `buildInternalApiOpenApiSources` resolves OpenAPI document URLs for the aggregator.

## Why this is a separate package

`service-catalog` keeps the cross-service routing table out of `@intexuraos/common-core`. Apps that need to talk to other internal services import this package; the rest are unaffected.

## Related Packages

- `@intexuraos/internal-clients` — uses the catalog to construct service-specific HTTP clients.
- `@intexuraos/common-core` — generic primitives consumed alongside this package.
