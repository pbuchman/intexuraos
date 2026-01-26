# Service-to-Service Communication

## Overview

IntexuraOS uses HTTP-based service-to-service communication for internal operations. This document describes the patterns, conventions, and best practices for implementing internal endpoints.

## Internal Endpoint Convention

### Pattern

All internal endpoints follow the pattern:

```
/internal/{service-prefix}/{resource-path}
```

**Components:**

- `/internal` - Fixed prefix indicating internal-only endpoint
- `{service-prefix}` - Short service identifier (e.g., `notion`, `user`, `promptvault`)
- `{resource-path}` - REST-style resource path (e.g., `users/:userId/context`)

### Service Prefixes

| Service            | Prefix     | Description                   |
| ------------------ | ---------- | ----------------------------- |
| `notion-service`   | `notion`   | Notion integration operations |
| `user-service`     | `user`     | User management and settings  |
| `whatsapp-service` | `whatsapp` | WhatsApp operations           |
| `llm-orchestrator` | `llm`      | LLM orchestration (future)    |

## Authentication

Internal endpoints use HTTP header-based authentication with a shared secret token.

### Header

```
X-Internal-Auth: <token>
```

### Environment Variable

```bash
INTEXURAOS_INTERNAL_AUTH_TOKEN=<shared-secret>
```

**Note:** Services should use the `INTEXURAOS_` prefix for consistency. Legacy services may use `INTERNAL_AUTH_TOKEN`.

### Server-Side Validation

```typescript
function validateInternalAuth(request: FastifyRequest): boolean {
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  if (internalAuthToken === '') {
    request.log.warn('Internal auth failed: INTEXURAOS_INTERNAL_AUTH_TOKEN not configured');
    return false;
  }
  const authHeader = request.headers['x-internal-auth'];
  if (authHeader !== internalAuthToken) {
    request.log.warn('Internal auth failed: token mismatch');
    return false;
  }
  return true;
}
```

**Usage in route:**

```typescript
async (request: FastifyRequest, reply: FastifyReply) => {
  if (!validateInternalAuth(request)) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }
  // Handle request...
};
```

### Client-Side Usage

```typescript
interface ServiceClient {
  baseUrl: string;
  internalAuthToken: string;
}

async function fetchFromService(client: ServiceClient, path: string): Promise<Response> {
  return fetch(`${client.baseUrl}${path}`, {
    headers: {
      'X-Internal-Auth': client.internalAuthToken,
    },
  });
}
```

## Current Internal Endpoints

### notion-service

#### GET /internal/notion/users/:userId/context

Get Notion connection context (token) for a user.

**Request:**

```
GET /internal/notion/users/user-123/context
X-Internal-Auth: <token>
```

**Response (200):**

```json
{
  "connected": true,
  "token": "secret_abc123..."
}
```

**Response (disconnected):**

```json
{
  "connected": false,
  "token": null
}
```

**Response (401):**

```json
{
  "error": "Unauthorized"
}
```

**Purpose:** Allows other services to retrieve Notion API tokens without direct Firestore access.

### user-service

#### GET /internal/users/:uid/llm-keys

Get decrypted LLM API keys for a user.

**Request:**

```
GET /internal/users/user-123/llm-keys
X-Internal-Auth: <token>
```

**Response (200):**

```json
{
  "google": "decrypted-key-or-null",
  "openai": "decrypted-key-or-null",
  "anthropic": "decrypted-key-or-null"
}
```

**Response (401):**

```json
{
  "error": "Unauthorized"
}
```

**Purpose:** Allows llm-orchestrator to retrieve decrypted API keys without direct access to encryption logic.

## Implementation Guide

### Creating an Internal Endpoint (Server)

1. **Create `internalRoutes.ts` in your service:**

```typescript
// apps/your-service/src/routes/internalRoutes.ts
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';

function validateInternalAuth(request: FastifyRequest): boolean {
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  if (internalAuthToken === '') {
    request.log.warn('Internal auth failed: INTEXURAOS_INTERNAL_AUTH_TOKEN not configured');
    return false;
  }
  const authHeader = request.headers['x-internal-auth'];
  if (authHeader !== internalAuthToken) {
    request.log.warn('Internal auth failed: token mismatch');
    return false;
  }
  return true;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/internal/yourservice/resource/:id',
    {
      schema: {
        operationId: 'getInternalResource',
        summary: 'Get resource (internal)',
        description: 'Internal endpoint for service-to-service communication.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Resource ID' },
          },
          required: ['id'],
        },
        response: {
          200: {
            description: 'Resource data',
            type: 'object',
            properties: {
              // Define your response schema
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!validateInternalAuth(request)) {
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      // Implement your logic here
      const params = request.params as { id: string };
      // ...
    }
  );

  done();
};
```

2. **Register the routes:**

```typescript
// apps/your-service/src/routes/index.ts
export { internalRoutes } from './internalRoutes.js';

// apps/your-service/src/routes/routes.ts
import { internalRoutes } from './index.js';

export const routes: FastifyPluginCallback = (fastify, _opts, done) => {
  // ... other routes
  fastify.register(internalRoutes);
  done();
};
```

3. **Configure environment variable:**

```bash
# .env or deployment config
INTEXURAOS_INTERNAL_AUTH_TOKEN=your-shared-secret
```

### Creating a Service Client (Consumer)

1. **Create client interface:**

```typescript
// apps/consumer-service/src/infra/yourservice/yourServiceClient.ts
import { err, ok, type Result } from '@intexuraos/common-core';

export interface YourServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export interface YourServiceClient {
  getResource(id: string): Promise<Result<ResourceData, ServiceError>>;
}

export function createYourServiceClient(config: YourServiceConfig): YourServiceClient {
  return {
    async getResource(id: string): Promise<Result<ResourceData, ServiceError>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/yourservice/resource/${id}`, {
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            return err({
              code: 'UNAUTHORIZED',
              message: 'Internal auth failed when calling yourservice',
            });
          }
          return err({
            code: 'DOWNSTREAM_ERROR',
            message: `yourservice returned ${String(response.status)}: ${response.statusText}`,
          });
        }

        const data = (await response.json()) as ResourceData;
        return ok(data);
      } catch (error) {
        return err({
          code: 'DOWNSTREAM_ERROR',
          message: `Failed to connect to yourservice: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    },
  };
}
```

2. **Wire up in dependency injection:**

```typescript
// apps/consumer-service/src/services.ts
import {
  createYourServiceClient,
  type YourServiceClient,
} from './infra/yourservice/yourServiceClient.js';

interface ServiceContainer {
  yourServiceClient: YourServiceClient;
  // ... other services
}

export function initServices(): void {
  const yourServiceUrl = process.env['INTEXURAOS_YOURSERVICE_URL'];
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

  if (!yourServiceUrl) {
    throw new Error('INTEXURAOS_YOURSERVICE_URL is not configured');
  }
  if (!internalAuthToken) {
    throw new Error('INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured');
  }

  container = {
    yourServiceClient: createYourServiceClient({
      baseUrl: yourServiceUrl,
      internalAuthToken,
    }),
    // ... other services
  };
}
```

## Best Practices

### Security

1. **Never expose internal endpoints publicly** - Use authentication middleware or separate internal routing
2. **Use strong, randomly generated tokens** - Minimum 32 characters
3. **Rotate tokens periodically** - Update via Secret Manager
4. **Log authentication failures** - Monitor for unauthorized access attempts
5. **Use HTTPS in production** - Encrypt token in transit

### Error Handling

1. **Return 401 for auth failures** - Don't leak information about why auth failed
2. **Use appropriate status codes:**
   - 401: Authentication failed
   - 404: Resource not found
   - 502: Downstream service error
   - 503: Service misconfigured
3. **Provide actionable error messages** - Include context for debugging
4. **Don't throw exceptions** - Return Result types for predictable error handling

### Performance

1. **No caching by default** - Keep data fresh unless explicitly needed
2. **Use parallel requests** - Fetch from multiple services with `Promise.all()` when possible
3. **Set reasonable timeouts** - Default fetch timeout is typically sufficient
4. **Monitor latency** - Track p50, p95, p99 for internal calls

### Testing

1. **Create fake implementations** - Mirror production interface exactly
2. **Inject via dependency injection** - Use `setServices()` in tests
3. **Test authentication** - Verify 401 responses for missing/invalid tokens
4. **Test error scenarios** - Service down, malformed responses, etc.

## Migration Guide

### Migrating from Direct Firestore Access

**Before (Direct Access):**

```typescript
import { getNotionToken } from '@intexuraos/infra-notion';

const tokenResult = await getNotionToken(userId);
```

**After (Service-to-Service):**

```typescript
const { notionServiceClient } = getServices();

const contextResult = await notionServiceClient.getNotionToken(userId);
if (!contextResult.ok) {
  // Handle error
}
const token = contextResult.value.token;
```

**Benefits:**

- Separation of concerns: Only notion-service manages `notion_connections`
- Security: No shared Firestore repository credentials
- Testability: Easy to inject fake clients
- Observability: HTTP requests can be logged/monitored

## Troubleshooting

### Common Issues

**401 Unauthorized:**

- Check `X-Internal-Auth` header is set
- Verify `INTEXURAOS_INTERNAL_AUTH_TOKEN` matches on both services
- Ensure token is not empty or whitespace

**Connection Refused:**

- Verify service URL is correct
- Check service is running and healthy
- Verify network connectivity (VPC, firewall rules)

**502 Bad Gateway:**

- Check downstream service logs for errors
- Verify service is responding to requests
- Check service health endpoint

## User Service Client

All apps use the shared `@intexuraos/internal-clients` package for user-service communication.

### Available Methods

| Method                               | Endpoint                                                  | Purpose                      |
| ------------------------------------ | --------------------------------------------------------- | ---------------------------- |
| `getApiKeys(userId)`                 | `GET /internal/users/{id}/llm-keys`                       | Fetch decrypted LLM API keys |
| `getLlmClient(userId)`               | Multiple                                                  | Create configured LLM client |
| `reportLlmSuccess(userId, provider)` | `POST /internal/users/{id}/llm-keys/{provider}/last-used` | Track usage                  |
| `getOAuthToken(userId, provider)`    | `GET /internal/users/{id}/oauth/{provider}/token`         | Get OAuth access token       |

### Usage

```typescript
import { createUserServiceClient } from '@intexuraos/internal-clients';

const client = createUserServiceClient({
  baseUrl: process.env.INTEXURAOS_USER_SERVICE_URL,
  internalAuthToken: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN,
  pricingContext,
  logger,
});

// Get API keys
const keysResult = await client.getApiKeys(userId);

// Get OAuth token (e.g., for Google Calendar)
const tokenResult = await client.getOAuthToken(userId, 'google');

// Get configured LLM client
const llmResult = await client.getLlmClient(userId);
```

## Future Considerations

1. **Service Mesh** - Consider Istio/Linkerd for automatic mTLS
2. **API Gateway** - Centralized routing and authentication
3. **Circuit Breakers** - Automatic failover for degraded services
4. **Distributed Tracing** - OpenTelemetry for request tracing
5. **Rate Limiting** - Protect services from excessive internal traffic

## References

- [Internal Routes Implementation (notion-service)](../../apps/notion-service/src/routes/internalRoutes.ts)
- [Internal Routes Implementation (user-service)](../../apps/user-service/src/routes/internalRoutes.ts)
- [Service Client Example](../../packages/internal-clients/src/user-service/client.ts)
- [Shared User Service Client](../../packages/internal-clients/src/user-service/client.ts)
