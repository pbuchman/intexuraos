# Task 5-2: Complete Server Setup

**Tier:** 5 (Depends on 5-0, 5-1)

---

## Context Snapshot

- Service scaffold exists from Tier 0
- Routes and schemas defined (5-0, 5-1)
- Need to wire everything together in server.ts

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Complete the server setup:

1. Register research routes
2. Configure authentication
3. Set up OpenAPI and Swagger
4. Configure CORS

---

## Scope

**In scope:**

- Update server.ts with route registration
- Add authentication plugin
- Configure OpenAPI spec generation
- Add health endpoint

**Non-scope:**

- DI container setup (task 5-3)
- Terraform (task 7-0)

---

## Required Approach

### Step 1: Update server.ts

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { registerHealth } from '@intexuraos/http-server';
import { researchRoutes } from './routes/index.js';
import { initializeServices } from './services.js';

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const fastify = Fastify({
    logger: true,
  });

  // CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // OpenAPI
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'LLM Orchestrator Service',
        description: 'Multi-LLM research with synthesis',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:8080' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  // Swagger UI
  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Health endpoint
  registerHealth(fastify);

  // Authentication decorator
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' },
      });
    }

    const token = authHeader.slice(7);
    // Verify JWT and extract user
    // For now, decode without verification for development
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      request.user = payload;
    } catch {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
      });
    }
  });

  // Register routes
  await fastify.register(researchRoutes);

  // OpenAPI JSON endpoint
  fastify.get('/openapi.json', async () => {
    return fastify.swagger();
  });

  return fastify;
}

export async function startServer(): Promise<void> {
  const server = await buildServer();
  await initializeServices();

  const port = parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    await server.listen({ port, host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
```

### Step 2: Update index.ts

```typescript
import { startServer } from './server.js';

startServer();
```

### Step 3: Add Fastify type augmentation

Create `types/fastify.d.ts`:

```typescript
import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: {
      sub: string;
      email?: string;
    };
  }
}
```

---

## Step Checklist

- [ ] Update server.ts with route registration
- [ ] Add authentication decorator
- [ ] Configure OpenAPI and Swagger
- [ ] Add CORS configuration
- [ ] Create Fastify type augmentation
- [ ] Update index.ts
- [ ] Run verification commands

---

## Definition of Done

1. Server starts without errors
2. Routes registered at `/research`
3. OpenAPI spec at `/openapi.json`
4. Swagger UI at `/docs`
5. Health check at `/health`
6. Authentication decorator available
7. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
npm run build
```

---

## Rollback Plan

If verification fails:

1. Revert changes to server.ts
2. Revert changes to index.ts
3. Remove types/fastify.d.ts
