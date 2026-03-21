# @intexuraos/http-contracts — Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/http-contracts
type: module
leaf: true
dependencies: none
entry_points:
  - ".": ./src/index.ts
```

## Exported Constants (OpenAPI Schemas)

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
const DiagnosticsSchema: { type: 'object'; properties: Record<string, { type: string }> };
const ErrorBodySchema: {
  type: 'object';
  required: ['code', 'message'];
  properties: Record<string, unknown>;
};
const ApiOkSchema: {
  type: 'object';
  required: ['success', 'data'];
  properties: Record<string, unknown>;
};
const ApiErrorSchema: {
  type: 'object';
  required: ['success', 'error'];
  properties: Record<string, unknown>;
};
const HealthCheckSchema: {
  type: 'object';
  required: ['name', 'status', 'latencyMs'];
  properties: Record<string, unknown>;
};
const HealthResponseSchema: {
  type: 'object';
  required: ['status', 'serviceName', 'version', 'timestamp', 'checks'];
  properties: Record<string, unknown>;
};

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

## Exported Constants (Fastify Schemas)

```typescript
const fastifyDiagnosticsSchema: {
  $id: 'Diagnostics';
  type: 'object';
  properties: Record<string, { type: string }>;
};
const fastifyErrorCodeSchema: { $id: 'ErrorCode'; type: 'string'; enum: string[] };
const fastifyErrorBodySchema: {
  $id: 'ErrorBody';
  type: 'object';
  required: string[];
  properties: Record<string, unknown>;
};
```

## Exported Functions

```typescript
function registerCoreSchemas(app: { addSchema: (schema: { $id: string }) => void }): void;
```

## Schema Reference Patterns

```
OpenAPI:  { $ref: '#/components/schemas/ErrorCode' }
Fastify:  { $ref: 'ErrorCode#' }
```

## Dependency Graph

```
http-contracts (leaf)
  <- all apps (18)
  <- http-server (transitively)
```

## Typical Usage Pattern

```typescript
// In server.ts
import {
  registerCoreSchemas,
  coreComponentSchemas,
  bearerAuthSecurityScheme,
} from '@intexuraos/http-contracts';

// 1. Register Fastify schemas for runtime validation
registerCoreSchemas(app);

// 2. Configure Swagger with OpenAPI schemas
await app.register(swagger, {
  openapi: {
    components: {
      schemas: { ...coreComponentSchemas },
      securitySchemes: { bearerAuth: bearerAuthSecurityScheme },
    },
  },
});
```
