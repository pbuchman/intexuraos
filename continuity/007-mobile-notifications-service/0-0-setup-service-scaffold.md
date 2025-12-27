# 0-0: Setup Service Scaffold

## Tier

0 (Setup)

## Context

Create the basic structure for the mobile-notifications service following existing patterns.

## Problem Statement

Need to scaffold a new Fastify service with standard project structure.

## Scope

- Create `apps/mobile-notifications-service/` directory structure
- Create package.json, tsconfig.json, Dockerfile
- Create server.ts, config.ts, services.ts
- Create .env.example with all required env vars
- Create basic health endpoint
- Add to root tsconfig.json references

## Non-Scope

- Domain logic
- Routes beyond health check
- Tests (covered in later tasks)
- Terraform (separate task)
- Cloud Build scripts (separate task)

## Required Approach

1. Copy structure from existing service (e.g., whatsapp-service)
2. Adapt config for mobile-notifications-service
3. Create minimal server with health endpoint
4. Create .env.example documenting all required variables
5. Ensure service starts without errors

## Step Checklist

- [ ] Create directory structure
- [ ] Create package.json with dependencies
- [ ] Create tsconfig.json
- [ ] Create Dockerfile
- [ ] Create src/server.ts
- [ ] Create src/config.ts (with INTEXURAOS\_ prefix for env vars)
- [ ] Create src/services.ts
- [ ] Create .env.example
- [ ] Add health endpoint
- [ ] Add to root tsconfig.json
- [ ] Verify `npm install` works
- [ ] Verify `npm run build` works

## Definition of Done

- Service scaffold complete
- `npm run build` passes
- Health endpoint returns 200

## Verification Commands

```bash
cd apps/mobile-notifications-service && npm install
npm run build
```

## Rollback Plan

Delete apps/mobile-notifications-service/ directory
