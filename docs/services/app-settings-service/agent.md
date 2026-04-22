# app-settings-service — Agent Interface

> Machine-readable specification for AI agent integration

## Identity

| Attribute | Value                                                      |
| --------- | ---------------------------------------------------------- |
| Name      | app-settings-service                                       |
| Role      | Platform configuration scaffold (minimal after v3.6.0)     |
| Goal      | Provide health check anchor for downstream service startup |

## Capabilities

### Health Check

**Endpoint:** `GET /health`

**When to use:** When verifying the service and its infrastructure dependencies (Firestore, secrets) are operational. Five services poll this endpoint at startup.

**Input Schema:**

```typescript
// No request body or headers required
```

**Output Schema:**

```typescript
interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  serviceName: string;
  version: string;
  timestamp: string;
  checks: HealthCheck[];
}

interface HealthCheck {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  details?: Record<string, unknown> | null;
}
```

**Example:**

```json
// Request
// GET /health

// Response (200)
{
  "status": "ok",
  "serviceName": "app-settings-service",
  "version": "0.0.4",
  "timestamp": "2026-04-22T12:00:00.000Z",
  "checks": [
    { "name": "secrets", "status": "ok", "latencyMs": 0 },
    { "name": "firestore", "status": "ok", "latencyMs": 15 }
  ]
}
```

### OpenAPI Specification

**Endpoint:** `GET /openapi.json`

**When to use:** When the cron-agent or api-docs-hub needs to discover this service's API contract.

**Output Schema:**

```typescript
// Standard OpenAPI 3.1.1 JSON document
```

## Constraints

**Do NOT:**

- Expect any business endpoints (pricing, usage costs) — all were removed in v3.6.0
- Send Bearer or X-Internal-Auth headers to system endpoints (not required)
- Rely on this service for LLM pricing — use `llm-usage-service` instead

**Requires:**

- Firestore connectivity for health check
- `INTEXURAOS_INTERNAL_AUTH_TOKEN` secret present in environment

## Usage Patterns

### Pattern 1: Startup Health Polling (ecosystem.config.cjs)

```
1. PM2 starts app-settings-service
2. Downstream service polls GET /health every 1s (max 30s)
3. When status === 'ok', downstream service starts
```

### Pattern 2: Service Catalog Discovery (cron-agent)

```
1. cron-agent reads service catalog config
2. Fetches GET /openapi.json for API contract
3. allowedOperations is [] — no callable operations
```

## Error Handling

| Error Code | Meaning              | Recovery Action                           |
| ---------- | -------------------- | ----------------------------------------- |
| 200        | Healthy              | Proceed with downstream startup           |
| 200        | Degraded (in body)   | Service running but Firestore unreachable |
| 500        | Server error         | Retry with backoff                        |

## Dependencies

| Service   | Why Needed                    | Failure Behavior                              |
| --------- | ----------------------------- | --------------------------------------------- |
| Firestore | Health check verification     | Health reports "degraded" or "down"           |

## Dependents

| Service        | Dependency Type           |
| -------------- | ------------------------- |
| user-service   | Startup health polling    |
| commands-agent | Startup health polling    |
| actions-agent  | Startup health polling    |
| research-agent | Startup health polling    |
| todos-agent    | Startup health polling    |
| cron-agent     | Service catalog (OpenAPI) |

---

**Last updated:** 2026-04-22
