# api-docs-hub — Agent Interface

> Machine-readable interface definition for AI agents interacting with api-docs-hub.

---

## Identity

| Field        | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| **Name**     | api-docs-hub                                               |
| **Role**     | API Documentation Aggregator                               |
| **Goal**     | Provide unified Swagger UI for all IntexuraOS service APIs |
| **Version**  | 2.1.0 (package) / 0.0.4 (OpenAPI spec)                    |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface ApiDocsHubTools {
  // Access Swagger UI (browser-only; serves interactive HTML)
  getDocumentation(): SwaggerUI;

  // Health check — returns config validation + source count
  getHealth(): HealthResponse;
}
```

### Types

```typescript
interface SwaggerUI {
  // Interactive documentation at /docs
  // Aggregates OpenAPI specs from all 15 configured services
  // Service selector dropdown uses name from OpenApiSource.name
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  serviceName: string;    // "api-docs-hub"
  version: string;        // "0.0.4"
  checks: HealthCheck[];
}

interface HealthCheck {
  name: string;           // "config"
  status: 'ok' | 'down';
  latencyMs: number;
  details?: {
    sourceCount: number;  // Number of configured OpenAPI sources (15)
  };
}

interface OpenApiSource {
  name: string; // Display name shown in Swagger UI dropdown
  url: string;  // Full URL to service's OpenAPI JSON endpoint
}
```

---

## Constraints

| Rule              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| **Read Only**     | No data modification — documentation only                         |
| **Public Access** | Both `/docs` and `/health` accessible without authentication      |
| **Source Config** | OpenAPI sources configured at deployment via 15 required env vars |
| **Client Fetch**  | Swagger UI fetches specs client-side — services must allow CORS   |
| **Fail Fast**     | Missing any of the 15 env vars causes startup crash               |

---

## Usage Patterns

### Access Documentation

```
Navigate to: https://api-docs-hub.intexuraos.com/docs

1. Select service from dropdown (top-left)
2. Browse endpoints by tag
3. Try endpoints with "Try it out" button
4. View request/response schemas
```

### Available Service Specs

- user-service
- notion-service
- whatsapp-service
- mobile-notifications-service
- research-agent
- commands-agent
- actions-agent
- data-insights-agent
- image-service
- notes-agent
- todos-agent
- app-settings-service
- bookmarks-agent
- calendar-agent
- chat-agent

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Swagger UI    │────▶│ Service 1 /docs │
│   (api-docs-hub)│     └─────────────────┘
│                 │     ┌─────────────────┐
│   Multi-spec    │────▶│ Service 2 /docs │
│   dropdown      │     └─────────────────┘
│                 │     ┌─────────────────┐
│                 │────▶│ Service N /docs │
└─────────────────┘     └─────────────────┘
```

---

## Configuration

The hub aggregates specs from configured sources:

```typescript
interface OpenApiSource {
  name: string; // Display name in dropdown
  url: string;  // URL to service's OpenAPI JSON
}

// All 15 sources loaded from required env vars at startup
// e.g. INTEXURAOS_USER_SERVICE_OPENAPI_URL -> { name: 'User Service API', url: value }
```

---

## Health Endpoint

| Method | Path      | Purpose              |
| ------ | --------- | -------------------- |
| GET    | `/health` | Service health check |

Health status is `'healthy'` when all 15 sources are configured, `'down'` if none are present.

---

**Last updated:** 2026-02-19
