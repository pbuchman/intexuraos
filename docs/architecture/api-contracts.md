# API Contracts

This document defines the API-level contracts for all PraxOS services.

## Response Envelopes

All API responses use a consistent JSON envelope structure.

### Success Response

```jsonc
{
  "success": true,
  "data": { /* response payload */ },
  "diagnostics": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "durationMs": 42
  }
}
```

| Field         | Type          | Required | Description               |
| ------------- | ------------- | -------- | ------------------------- |
| `success`     | `true`        | Yes      | Discriminator for success |
| `data`        | `T`           | Yes      | Response payload          |
| `diagnostics` | `Diagnostics` | No       | Request metadata          |

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Validation failed: email is required",
    "details": { "field": "email" }
  },
  "diagnostics": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "durationMs": 12,
    "downstreamStatus": 400,
    "downstreamRequestId": "ext-req-123",
    "endpointCalled": "https://api.example.com/validate"
  }
}
```

| Field           | Type          | Required | Description                     |
| --------------- | ------------- | -------- | ------------------------------- |
| `success`       | `false`       | Yes      | Discriminator for error         |
| `error.code`    | `ErrorCode`   | Yes      | Machine-readable error code     |
| `error.message` | `string`      | Yes      | Human-readable message          |
| `error.details` | `unknown`     | No       | Additional context (no secrets) |
| `diagnostics`   | `Diagnostics` | No       | Request metadata                |

## Error Codes

All services use a shared error code catalog.

| Code               | HTTP Status | Description                       |
| ------------------ | ----------- | --------------------------------- |
| `INVALID_REQUEST`  | 400         | Malformed or invalid request      |
| `UNAUTHORIZED`     | 401         | Missing or invalid authentication |
| `FORBIDDEN`        | 403         | Authenticated but not authorized  |
| `NOT_FOUND`        | 404         | Resource does not exist           |
| `CONFLICT`         | 409         | Resource state conflict           |
| `DOWNSTREAM_ERROR` | 502         | External service failure          |
| `INTERNAL_ERROR`   | 500         | Unexpected server error           |
| `MISCONFIGURED`    | 503         | Service misconfiguration          |

### Error Code Rules

- Error codes are stable and must not change meaning.
- New codes require documentation update.
- Codes must be uppercase snake_case.
- Message must not leak secrets or internal paths.

## Diagnostics

The diagnostics object provides request tracing information.

| Field                 | Type     | When Included                                  |
| --------------------- | -------- | ---------------------------------------------- |
| `requestId`           | `string` | Always                                         |
| `durationMs`          | `number` | Always                                         |
| `downstreamStatus`    | `number` | On downstream call                             |
| `downstreamRequestId` | `string` | If downstream provides request ID              |
| `endpointCalled`      | `string` | On downstream call (URL only, no query params) |

### Diagnostics Rules

- `requestId` must be propagated to all downstream calls.
- `durationMs` measures total request time.
- `endpointCalled` must not include query parameters or secrets.
- Downstream diagnostics only included when relevant to error.

## Request ID

Request IDs enable distributed tracing across services.

### Header

```
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

### Rules

- Header name: `x-request-id` (case-insensitive)
- If not provided by client, service generates UUID v4.
- Request ID is returned in response header.
- Request ID is included in all log entries.
- Request ID is propagated to downstream services.

## Healthcheck Contract

All services implement `GET /health` with consistent response shape.

### Response

```json
{
  "status": "ok",
  "serviceName": "auth-service",
  "version": "0.0.1",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": [
    {
      "name": "secrets",
      "status": "ok",
      "latencyMs": 15,
      "details": null
    },
    {
      "name": "firestore",
      "status": "ok",
      "latencyMs": 42,
      "details": null
    }
  ]
}
```

### Status Values

| Status     | Meaning                          |
| ---------- | -------------------------------- |
| `ok`       | All checks passing               |
| `degraded` | Some non-critical checks failing |
| `down`     | Critical checks failing          |

### Check Object

| Field       | Type                           | Description                  |
| ----------- | ------------------------------ | ---------------------------- |
| `name`      | `string`                       | Check identifier             |
| `status`    | `"ok" \| "degraded" \| "down"` | Check status                 |
| `latencyMs` | `number`                       | Check duration               |
| `details`   | `unknown \| null`              | Additional info (no secrets) |

### Healthcheck Rules

- Health endpoint must not require authentication.
- Checks must perform real dependency calls (not just config presence).
- Check timeout: 5 seconds per check.
- Total endpoint timeout: 10 seconds.
- Failed checks must not crash the service.

## OpenAPI

Each service exposes OpenAPI documentation.

### Endpoints

| Endpoint            | Description               |
| ------------------- | ------------------------- |
| `GET /openapi.json` | OpenAPI 3.0 specification |
| `GET /docs`         | Swagger UI                |

### Rules

- OpenAPI spec must include unified response schema components.
- Spec must be generated at runtime by Fastify, not hand-written.
- Spec must include all error codes.
- Swagger UI must be accessible without authentication.
- No build-time OpenAPI generation or CI validation of specs.

### Runtime OpenAPI Aggregation

PraxOS provides a central API documentation hub (`api-docs-hub`) that aggregates OpenAPI specs from all services.

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    api-docs-hub                             │
│                                                             │
│  GET /docs → Swagger UI with service selector dropdown      │
│                                                             │
│  Fetches specs at runtime from:                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ AUTH_SERVICE_OPENAPI_URL → Auth Service /openapi.json   ││
│  │ NOTION_GPT_SERVICE_OPENAPI_URL → Notion GPT /openapi.json│
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

#### Key Characteristics

- **Runtime-only**: OpenAPI specs are generated and served at runtime by each service.
- **No caching**: api-docs-hub fetches specs directly from target services.
- **No proxying**: Users' browsers fetch specs directly from service URLs.
- **Environment-driven**: Service URLs are injected via environment variables by Terraform.
- **Not a source of truth**: api-docs-hub is a pure UI aggregator with no business logic.

#### Environment Variables

| Variable                         | Description                            |
| -------------------------------- | -------------------------------------- |
| `AUTH_SERVICE_OPENAPI_URL`       | URL to auth-service OpenAPI JSON       |
| `NOTION_GPT_SERVICE_OPENAPI_URL` | URL to notion-gpt-service OpenAPI JSON |

These values are constructed by Terraform from Cloud Run service URLs and injected as plain environment variables (not secrets).

### Schema Components

All specs must reference these shared components:

```yaml
components:
  schemas:
    ApiOk:
      type: object
      properties:
        success:
          type: boolean
          enum: [true]
        data:
          type: object
        diagnostics:
          $ref: '#/components/schemas/Diagnostics'
    ApiError:
      type: object
      properties:
        success:
          type: boolean
          enum: [false]
        error:
          $ref: '#/components/schemas/ErrorBody'
        diagnostics:
          $ref: '#/components/schemas/Diagnostics'
    ErrorBody:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
        message:
          type: string
        details:
          type: object
    Diagnostics:
      type: object
      properties:
        requestId:
          type: string
        durationMs:
          type: number
        downstreamStatus:
          type: integer
        downstreamRequestId:
          type: string
        endpointCalled:
          type: string
    HealthResponse:
      type: object
      required: [status, serviceName, version, timestamp, checks]
      properties:
        status:
          type: string
          enum: [ok, degraded, down]
        serviceName:
          type: string
        version:
          type: string
        timestamp:
          type: string
          format: date-time
        checks:
          type: array
          items:
            $ref: '#/components/schemas/HealthCheck'
    HealthCheck:
      type: object
      required: [name, status, latencyMs]
      properties:
        name:
          type: string
        status:
          type: string
          enum: [ok, degraded, down]
        latencyMs:
          type: number
        details:
          type: object
          nullable: true
```

## No Dummy Success Rule

Success responses must include verifiable identifiers when relevant.

### Examples

```jsonc
// ✗ Bad: no way to verify success
{ "success": true, "data": { "created": true } }

// ✓ Good: includes verifiable identifier
{ "success": true, "data": { "id": "usr_123", "createdAt": "2024-01-15T10:30:00Z" } }
```

### Rules

- Create operations must return resource ID.
- Update operations must return updated timestamp or version.
- Delete operations must return deleted resource ID.
- Query operations must return result count and pagination info.

## Endpoint Categories

### Business Endpoints

Business endpoints (e.g., `/v1/*`) use the unified response envelope:

- Success: `{ "success": true, "data": {...}, "diagnostics": {...} }`
- Error: `{ "success": false, "error": {...}, "diagnostics": {...} }`

These endpoints implement domain logic and require authentication.

### System Endpoints

System endpoints are NOT wrapped in the unified envelope:

| Endpoint            | Response Format                |
| ------------------- | ------------------------------ |
| `GET /health`       | Raw `HealthResponse` object    |
| `GET /docs`         | Swagger UI HTML                |
| `GET /openapi.json` | Raw OpenAPI specification JSON |

System endpoints do not require authentication.

## Authentication

### JWT Validation (Step 6+)

Protected endpoints require a valid JWT token:

```
Authorization: Bearer <jwt>
```

#### Validation Rules

- **Signature**: Verified against JWKS (fetched from `AUTH_JWKS_URL`)
- **Issuer** (`iss`): Must match `AUTH_ISSUER`
- **Audience** (`aud`): Must match `AUTH_AUDIENCE`
- **Expiration** (`exp`): Token must not be expired
- **Subject** (`sub`): Must be present and non-empty

#### User Identity

The `userId` is derived directly from the JWT `sub` claim:

```
userId = jwt.sub
```

This provides a stable identifier across sessions.

#### Required Environment Variables

| Variable        | Description                   | Example                                               |
| --------------- | ----------------------------- | ----------------------------------------------------- |
| `AUTH_JWKS_URL` | URL to fetch JSON Web Key Set | `https://your-tenant.auth0.com/.well-known/jwks.json` |
| `AUTH_ISSUER`   | Expected token issuer         | `https://your-tenant.auth0.com/`                      |
| `AUTH_AUDIENCE` | Expected token audience       | `urn:praxos:api`                                      |

All three variables must be set for authentication to work.
If any are missing, protected endpoints return `503 MISCONFIGURED`.

## auth-service Endpoints

The auth-service provides Device Authorization Flow helpers for CLI/device authentication.

### Configuration

| Variable          | Description              | Example                   |
| ----------------- | ------------------------ | ------------------------- |
| `AUTH0_DOMAIN`    | Auth0 tenant domain      | `praxos-dev.eu.auth0.com` |
| `AUTH0_CLIENT_ID` | Native app client ID     | `abc123...`               |
| `AUTH_AUDIENCE`   | API identifier (default) | `urn:praxos:api`          |

If any required variable is missing, endpoints return `503 MISCONFIGURED`.

### POST /v1/auth/device/start

Start Device Authorization Flow. Returns device code and user code.

**Request:**

```json
{
  "audience": "urn:praxos:api",
  "scope": "openid profile email"
}
```

| Field      | Type     | Required | Default                  |
| ---------- | -------- | -------- | ------------------------ |
| `audience` | `string` | No       | From `AUTH_AUDIENCE` env |
| `scope`    | `string` | No       | `openid profile email`   |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "device_code": "XXXX-XXXX-XXXX",
    "user_code": "ABCD-EFGH",
    "verification_uri": "https://tenant.auth0.com/activate",
    "verification_uri_complete": "https://tenant.auth0.com/activate?user_code=ABCD-EFGH",
    "expires_in": 900,
    "interval": 5
  },
  "diagnostics": { "requestId": "..." }
}
```

### POST /v1/auth/device/poll

Poll for token after user authorization.

**Request:**

```json
{
  "device_code": "XXXX-XXXX-XXXX"
}
```

| Field         | Type     | Required |
| ------------- | -------- | -------- |
| `device_code` | `string` | Yes      |

**Pending Response (409 CONFLICT):**

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Authorization pending. User has not yet completed authentication."
  }
}
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "openid profile email"
  }
}
```

### GET /v1/auth/config

Get non-secret auth configuration for troubleshooting.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "domain": "praxos-dev.eu.auth0.com",
    "issuer": "https://praxos-dev.eu.auth0.com/",
    "audience": "urn:praxos:api",
    "jwksUrl": "https://praxos-dev.eu.auth0.com/.well-known/jwks.json"
  }
}
```

**Note:** This endpoint does not expose `client_id` or any secrets.

#### Error Responses

| Condition           | Error Code      | HTTP Status |
| ------------------- | --------------- | ----------- |
| Missing auth header | `UNAUTHORIZED`  | 401         |
| Invalid auth format | `UNAUTHORIZED`  | 401         |
| Invalid/expired JWT | `UNAUTHORIZED`  | 401         |
| Missing `sub` claim | `UNAUTHORIZED`  | 401         |
| Auth not configured | `MISCONFIGURED` | 503         |
