# 5-2: Server Setup

**Tier:** 5 - LLM Orchestrator Routes & Server
**Status:** Pending

## Context

Set up Fastify server with health, OpenAPI, and Swagger.

## Problem Statement

Need HTTP server with standard endpoints and documentation.

## Scope

**In Scope:**
- Create server.ts with Fastify setup
- Health endpoint at GET /health
- OpenAPI spec at GET /openapi.json
- Swagger UI at GET /docs
- CORS configuration

**Out of Scope:**
- Route handlers (5-1)
- Background worker (5-4)

## Required Approach

1. Follow existing server patterns
2. Use @intexuraos/http-server utilities
3. Register fastify-swagger plugins

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/server.ts`
- [ ] Initialize Fastify with logger
- [ ] Register health check route
- [ ] Register fastify-swagger for OpenAPI
- [ ] Register fastify-swagger-ui for docs
- [ ] Configure CORS
- [ ] Register auth plugin
- [ ] Register research routes
- [ ] Export createServer function

## Definition of Done

- [ ] Server starts without errors
- [ ] Health endpoint responds 200
- [ ] OpenAPI spec available
- [ ] Swagger UI accessible
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
# Manual: start server and check endpoints
```

## Rollback Plan

Delete server.ts.
