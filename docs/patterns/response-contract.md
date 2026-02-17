# HTTP Response Contract

All IntexuraOS HTTP endpoints MUST use a standardized response format enforced by the `intexuraFastifyPlugin` from `@intexuraos/common-http`.

## Response Formats

### Success Responses

```typescript
reply.ok(data);
// Returns: { success: true, data: T }
```

### Error Responses

```typescript
reply.fail('ERROR_CODE', 'Human-readable message');
// Returns: { success: false, error: { code: string, message: string } }
```

### Error Code to HTTP Status Mapping

| Error Code         | HTTP Status | When to Use                                          |
| ------------------ | ----------- | ---------------------------------------------------- |
| `UNAUTHORIZED`     | 401         | Missing or invalid authentication                    |
| `FORBIDDEN`        | 403         | Valid auth but insufficient permissions              |
| `NOT_FOUND`        | 404         | Resource does not exist                              |
| `CONFLICT`         | 409         | Duplicate, concurrent edit, or state conflict        |
| `INVALID_REQUEST`  | 400         | Malformed request or validation failure              |
| `RATE_LIMITED`     | 429         | Rate limit exceeded                                  |
| `INTERNAL_ERROR`   | 500         | Unexpected server error                              |
| `DOWNSTREAM_ERROR` | 502         | External service failure                             |
| `MISCONFIGURED`    | 503         | Service configuration issue (dispatch failure, etc.) |

## Plugin Setup

Register the plugin in your service's `server.ts`:

```typescript
import { intexuraFastifyPlugin } from '@intexuraos/common-http';

export async function createServer() {
  const app = Fastify();

  // Register after cors
  await app.register(intexuraFastifyPlugin);

  return app;
}
```

## Valid Exceptions

Some endpoints MUST use raw `reply.send()` due to external contract requirements:

| Pattern                          | Reason                              |
| -------------------------------- | ----------------------------------- |
| OAuth token endpoints            | OAuth2 spec requires flat responses |
| External webhook callbacks       | Third-party expects specific format |
| WhatsApp Meta webhooks           | Meta API contract                   |
| Binary responses (images, files) | Not JSON                            |

Mark exceptions with a comment:

```typescript
// @allow-raw-send: OAuth2 spec requires flat response
return reply.send({ access_token, token_type: 'Bearer' });
```

## Schema Updates

When using `reply.ok()` or `reply.fail()`, update Fastify response schemas to match:

```typescript
response: {
  200: {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        required: ['id', 'status'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
  },
  404: {
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: ['NOT_FOUND'] },
          message: { type: 'string' },
        },
      },
    },
  },
}
```

## Verification

The response contract is enforced by CI:

```bash
pnpm run verify:reply-send
```

This script detects raw `reply.send()` usage and fails unless annotated with `// @allow-raw-send:`.

## Client Handling

The web app's `apiClient.ts` expects wrapped responses:

```typescript
const response = await apiClient.get<{ tasks: Task[] }>('/code/tasks');
// response.data.tasks - correctly unwrapped
```

Bare responses (without `{ success, data }`) cause "Invalid response format" errors.
