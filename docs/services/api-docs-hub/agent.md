# api-docs-hub — Agent Interface

> Machine-readable interface definition for AI agents interacting with api-docs-hub.

---

## Identity

| Field    | Value                                                      |
| --------  | ----------------------------------------------------------  |
| **Name** | api-docs-hub                                               |
| **Role** | API Documentation Aggregator                               |
| **Goal** | Provide unified Swagger UI for all IntexuraOS service APIs |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface ApiDocsHubTools {
  // Access Swagger UI
  getDocumentation(): SwaggerUI;

  // Health check
  getHealth(): HealthResponse;
}
```

### Types

```typescript
interface SwaggerUI {
  // Interactive documentation at /docs
  // Aggregates OpenAPI specs from all services
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  serviceName: string;
  version: string;
  checks: HealthCheck[];
}

interface HealthCheck {
  name: string;
  status: 'ok' | 'down';
  latencyMs: number;
  details?: Record<string, unknown>;
}
```

---

## Constraints

| Rule              | Description                                  |
| -----------------  | --------------------------------------------  |
| **Read Only**     | No data modification - documentation only    |
| **Public Access** | Swagger UI accessible without authentication |
| **Source Config** | OpenAPI sources configured at deployment     |

---

## Usage Patterns

### Access Documentation

```
Navigate to: https://api-docs-hub.intexuraos.app/docs

1. Select service from dropdown (top-right)
2. Browse endpoints by tag
3. Try endpoints with "Try it out" button
4. View request/response schemas
```

### Available Service Specs

- actions-agent
- research-agent
- commands-agent
- todos-agent
- bookmarks-agent
- notes-agent
- calendar-agent
- linear-agent
- image-service
- web-agent
- whatsapp-service
- user-service
- mobile-notifications-service
- notion-service
- promptvault-service
- app-settings-service
- data-insights-agent

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
  url: string; // URL to service's OpenAPI JSON
}

// Example configuration
const sources: OpenApiSource[] = [
  { name: 'actions-agent', url: 'https://actions-agent.../docs/json' },
  { name: 'research-agent', url: 'https://research-agent.../docs/json' },
  // ... all services
];
```

---

## Health Endpoint

| Method | Path      | Purpose              |
| ------  | ---------  | --------------------  |
| GET    | `/health` | Service health check |

---

**Last updated:** 2026-01-19
