# @intexuraos/service-catalog

Canonical registry of IntexuraOS internal HTTP services and their environment-variable bindings. Used to compose service URLs (for cross-service calls) and OpenAPI document sources (for `api-docs-hub` aggregation).

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf catalog package)

## Why It Exists

Previously, every service that needed to call another internal service hand-rolled its own `process.env.INTEXURAOS_<SERVICE>_URL` lookup, with no shared list of which services exist or which environment variables back them. Adding a new internal service meant editing N callers; renaming an env var meant a global search-and-pray. The catalog flips the dependency: the list of services is data, callers are derived, and the env-var validator can iterate the catalog to enforce that every URL is set in every environment.

## Exports

| Entry Point | Path        | Contents                                                 |
| ----------- | ----------- | -------------------------------------------------------- |
| Main        | `.` (index) | Catalog entries + URL/OpenAPI builders + env-var arrays  |

## API Reference

### Catalog Shape

```typescript
interface InternalApiServiceCatalogEntry {
  key: string;                 // stable identifier, e.g. 'code-agent'
  name: string;                // human-readable, e.g. 'Code Agent'
  apiDocsName: string;         // tab label in api-docs-hub
  baseUrlEnvVar: string;       // e.g. 'INTEXURAOS_CODE_AGENT_URL'
  openApiUrlEnvVar: string;    // e.g. 'INTEXURAOS_CODE_AGENT_OPENAPI_URL'
}

const INTERNAL_API_SERVICE_CATALOG: InternalApiServiceCatalogEntry[];
```

### Derived Constants

```typescript
const INTERNAL_API_BASE_URL_ENV_VARS: string[];
const INTERNAL_API_OPENAPI_URL_ENV_VARS: string[];
```

`validateRequiredEnv` and CI scripts iterate these arrays to ensure every service in the catalog has a corresponding env-var binding wired in `terraform/`, `ecosystem.config.cjs`, and Cloud Run service config.

### Builders

```typescript
interface InternalApiServiceDefinition {
  key: string;
  name: string;
  url: string;        // resolved baseUrl
  openapiUrl: string; // resolved openapi spec URL
}

interface InternalApiOpenApiSource {
  key: string;
  name: string;
  url: string;
}

function buildInternalApiServiceDefinitions(
  env: Record<string, string | undefined>,
): InternalApiServiceDefinition[];

function buildInternalApiOpenApiSources(
  env: Record<string, string | undefined>,
): InternalApiOpenApiSource[];
```

Both builders skip entries whose env var is unset, so a single Cloud Run instance with a partial subset of internal URLs still composes a valid (if shorter) service list. Callers that require completeness should pre-validate via `INTERNAL_API_BASE_URL_ENV_VARS`.

## Usage

```typescript
import { buildInternalApiServiceDefinitions } from '@intexuraos/service-catalog';

const services = buildInternalApiServiceDefinitions(process.env);
const codeAgent = services.find((s) => s.key === 'code-agent');
if (codeAgent === undefined) {
  throw new Error('INTEXURAOS_CODE_AGENT_URL is not set');
}
const response = await fetch(`${codeAgent.url}/internal/tasks/${id}`, ...);
```

## Adding a New Service

1. Append an `InternalApiServiceCatalogEntry` to `INTERNAL_API_SERVICE_CATALOG` in `internalServiceCatalog.ts`.
2. Wire the same `baseUrlEnvVar` (and `openApiUrlEnvVar` if the service exposes OpenAPI) in `terraform/environments/dev/main.tf`, `ecosystem.config.cjs`, and the consuming service's `REQUIRED_ENV` list (`apps/<consumer>/src/index.ts`).
3. CI's env-var validator iterates the catalog and fails the build if any binding is missing.

## Layering

Pure data + builders, no I/O. Callers (api-docs-hub, internal HTTP clients, env-validation scripts) own the resolution and error handling for missing env vars.
