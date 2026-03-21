# @intexuraos/http-contracts

Shared API contract definitions for IntexuraOS services. Provides both OpenAPI schema definitions (for Swagger documentation) and Fastify JSON Schemas (for runtime route validation). This package ensures all services describe their APIs with consistent schema structures.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf package)

## API Reference

### OpenAPI Schemas (`openapi-schemas.ts`)

JSON Schema definitions for `@fastify/swagger` configuration. These define the shape of API responses in OpenAPI documentation.

#### Error Codes

```typescript
const ERROR_CODES: readonly [
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DOWNSTREAM_ERROR',
  'INTERNAL_ERROR',
  'MISCONFIGURED',
];

const ErrorCodeSchema: { type: 'string'; enum: string[] };
```

Note: `ERROR_CODES` lists only 8 generic HTTP-aligned codes. Domain-specific codes (e.g., `WORKER_UNAVAILABLE`, `NOTION_NOT_CONNECTED`) are defined in `common-core` but not enumerated here. See technical debt.

#### Response Schemas

```typescript
const DiagnosticsSchema: {
  type: 'object';
  properties: {
    requestId: { type: 'string' };
    durationMs: { type: 'number' };
    downstreamStatus: { type: 'integer' };
    downstreamRequestId: { type: 'string' };
    endpointCalled: { type: 'string' };
  };
};

const ErrorBodySchema: {
  type: 'object';
  required: ['code', 'message'];
  properties: {
    code: { $ref: '#/components/schemas/ErrorCode' };
    message: { type: 'string' };
    details: { type: 'object'; additionalProperties: true };
  };
};

const ApiOkSchema: {
  type: 'object';
  required: ['success', 'data'];
  properties: {
    success: { type: 'boolean'; enum: [true] };
    data: { type: 'object' };
    diagnostics: { $ref: '#/components/schemas/Diagnostics' };
  };
};

const ApiErrorSchema: {
  type: 'object';
  required: ['success', 'error'];
  properties: {
    success: { type: 'boolean'; enum: [false] };
    error: { $ref: '#/components/schemas/ErrorBody' };
    diagnostics: { $ref: '#/components/schemas/Diagnostics' };
  };
};
```

#### Health Check Schemas

```typescript
const HealthCheckSchema: {
  type: 'object';
  required: ['name', 'status', 'latencyMs'];
  properties: {
    name: { type: 'string' };
    status: { type: 'string'; enum: ['ok', 'degraded', 'down'] };
    latencyMs: { type: 'number' };
    details: { type: 'object'; nullable: true };
  };
};

const HealthResponseSchema: {
  type: 'object';
  required: ['status', 'serviceName', 'version', 'timestamp', 'checks'];
  properties: {
    status: { type: 'string'; enum: ['ok', 'degraded', 'down'] };
    serviceName: { type: 'string' };
    version: { type: 'string' };
    timestamp: { type: 'string'; format: 'date-time' };
    checks: { type: 'array'; items: { $ref: '#/components/schemas/HealthCheck' } };
  };
};
```

#### Convenience Exports

```typescript
const coreComponentSchemas: {
  ErrorCode: typeof ErrorCodeSchema;
  Diagnostics: typeof DiagnosticsSchema;
  ErrorBody: typeof ErrorBodySchema;
  ApiOk: typeof ApiOkSchema;
  ApiError: typeof ApiErrorSchema;
  HealthCheck: typeof HealthCheckSchema;
  HealthResponse: typeof HealthResponseSchema;
};

const bearerAuthSecurityScheme: {
  type: 'http';
  scheme: 'bearer';
  bearerFormat: 'JWT';
  description: string;
};
```

**Usage in Swagger config:**

```typescript
import { coreComponentSchemas, bearerAuthSecurityScheme } from '@intexuraos/http-contracts';

const swaggerConfig = {
  openapi: {
    components: {
      schemas: {
        ...coreComponentSchemas,
        // service-specific schemas
      },
      securitySchemes: {
        bearerAuth: bearerAuthSecurityScheme,
      },
    },
  },
};
```

### Fastify Schemas (`fastify-schemas.ts`)

Fastify JSON Schemas use `$id` for local reference (distinct from OpenAPI `$ref` syntax).

```typescript
const fastifyDiagnosticsSchema: { $id: 'Diagnostics'; type: 'object'; properties: { /* ... */ } };
const fastifyErrorCodeSchema: { $id: 'ErrorCode'; type: 'string'; enum: string[] };
const fastifyErrorBodySchema: {
  $id: 'ErrorBody';
  type: 'object';
  required: ['code', 'message'];
  properties: { /* ... */ };
};

function registerCoreSchemas(app: { addSchema: (schema: { $id: string }) => void }): void;
```

**Usage:**

```typescript
import { registerCoreSchemas } from '@intexuraos/http-contracts';

const app = Fastify();
registerCoreSchemas(app);

// Now reference schemas in routes:
app.get(
  '/items',
  {
    schema: {
      response: {
        400: { $ref: 'ErrorBody#' },
      },
    },
  },
  handler
);
```

## Used By

**Apps (18):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web-agent`, `whatsapp-service`

**Packages (1):** `http-server` (transitively)

## Recent Changes

No changes since package creation — schemas are stable.

## Source Files

| File                     | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `src/index.ts`           | Entry point, re-exports all schemas                |
| `src/openapi-schemas.ts` | OpenAPI JSON Schema definitions for Swagger        |
| `src/fastify-schemas.ts` | Fastify JSON Schemas with $id for route validation |
