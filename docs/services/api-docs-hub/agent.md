# api-docs-hub — Agent Interface

> Machine-readable specification for AI agent integration

## Identity

| Attribute   | Value                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| **Name**    | api-docs-hub                                                            |
| **Role**    | Aggregates OpenAPI specs from 20 services into a single Swagger UI      |
| **Goal**    | Provide a unified documentation portal for all IntexuraOS service APIs  |
| **Version** | 3.4.0 (package) / 0.0.5 (OpenAPI spec)                                  |

---

## Capabilities

### View Documentation

**Endpoint:** `GET /docs`

**When to use:** When a human needs to browse, discover, or test IntexuraOS API endpoints interactively.

**Note:** This endpoint serves an HTML page (Swagger UI). It is browser-only and not useful for programmatic access by agents.

**Output:** Interactive Swagger UI HTML page with a service selector dropdown listing all 20 configured services.

### Check Health

**Endpoint:** `GET /health`

**When to use:** To verify the documentation hub is running and properly configured with all service sources.

**Output Schema:**

```typescript
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  serviceName: 'api-docs-hub';
  version: '0.0.5';
  checks: HealthCheck[];
}

interface HealthCheck {
  name: 'config';
  status: 'ok' | 'down';
  latencyMs: number;
  details: {
    sourceCount: number;  // Expected: 20
  };
}
```

**Example:**

```json
// Request
// GET /health

// Response
{
  "status": "healthy",
  "serviceName": "api-docs-hub",
  "version": "0.0.5",
  "checks": [
    {
      "name": "config",
      "status": "ok",
      "latencyMs": 0,
      "details": { "sourceCount": 20 }
    }
  ]
}
```

---

## Constraints

**Do NOT:**

- Use `/docs` for programmatic API discovery — it serves HTML, not machine-readable data
- Expect the hub to proxy or cache OpenAPI specs — specs are fetched client-side by the browser
- Call this service for any data mutation — it is entirely read-only

**Requires:**

- All 20 `INTEXURAOS_*_OPENAPI_URL` environment variables set at startup
- Target services must be running and CORS-enabled for the browser to fetch their specs

---

## Usage Patterns

### Pattern 1: Health Verification

```
1. GET /health
2. Assert response.status === 'healthy'
3. Assert response.checks[0].details.sourceCount === 20
```

### Pattern 2: Direct Service Spec Access

To programmatically access a service's OpenAPI spec, bypass the hub entirely and fetch from the service directly:

```
1. Look up the service URL from environment (e.g., INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL)
2. GET {serviceUrl}/openapi.json
3. Parse the OpenAPI 3.1.1 JSON response
```

---

## Available Service Specs (20)

| Service                          | Env Var Key                                               |
| -------------------------------- | --------------------------------------------------------- |
| User Service API                 | `INTEXURAOS_USER_SERVICE_OPENAPI_URL`                     |
| Notion Service API               | `INTEXURAOS_NOTION_SERVICE_OPENAPI_URL`                   |
| WhatsApp Service API             | `INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL`                 |
| Mobile Notifications Service API | `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL`     |
| Research Agent API               | `INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL`                   |
| Commands Agent API               | `INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL`                   |
| Actions Agent API                | `INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL`                    |
| Data Insights Agent API          | `INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL`              |
| Image Service API                | `INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL`                    |
| Notes Agent API                  | `INTEXURAOS_NOTES_AGENT_OPENAPI_URL`                      |
| Todos Agent API                  | `INTEXURAOS_TODOS_AGENT_OPENAPI_URL`                      |
| Application Settings API         | `INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL`             |
| Bookmarks Agent API              | `INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL`                  |
| Calendar Agent API               | `INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL`                   |
| Chat Agent API                   | `INTEXURAOS_CHAT_AGENT_OPENAPI_URL`                       |
| Code Agent API                   | `INTEXURAOS_CODE_AGENT_OPENAPI_URL`                       |
| Linear Agent API                 | `INTEXURAOS_LINEAR_AGENT_OPENAPI_URL`                     |
| Web Agent API                    | `INTEXURAOS_WEB_AGENT_OPENAPI_URL`                        |
| Cron Agent API                   | `INTEXURAOS_CRON_AGENT_OPENAPI_URL`                       |
| Hellscript Agent API             | `INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL`                 |

---

## Error Handling

| Status | Meaning                              | Recovery Action                                      |
| ------ | ------------------------------------ | ---------------------------------------------------- |
| 200    | Success                              | None needed                                          |
| 404    | Unknown path                         | Use `/docs` or `/health` only                        |
| 500    | Server error                         | Check logs for startup misconfiguration              |
| N/A    | Service fails to start               | Verify all 20 env vars are set; check `direnv allow` |

---

## Dependencies

| Dependency                    | Why Needed                     | Failure Behavior          |
| ----------------------------- | ------------------------------ | ------------------------- |
| `@fastify/swagger-ui`         | Serves Swagger UI interface    | Service cannot start      |
| `@intexuraos/common-core`     | Shared internal API catalog    | Build fails               |
| `@intexuraos/infra-sentry`    | Error tracking and log streams | Degrades gracefully       |
| `@intexuraos/infra-otel`      | Dash0 log forwarding           | Optional; no-op if absent |

---

## Architecture

The hub serves Swagger UI HTML to the browser. The browser then fetches OpenAPI specs directly from each of the 20 target services. The hub does not proxy or cache any specs.

1. Browser sends `GET /docs` to API Docs Hub
2. Hub returns Swagger UI HTML with `urls` config listing all 20 services
3. Browser fetches `GET /openapi.json` from the selected target service
4. Browser renders the interactive API documentation

---

**Last updated:** 2026-03-22
