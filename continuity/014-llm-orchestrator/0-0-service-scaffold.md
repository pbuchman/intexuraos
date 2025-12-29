# 0-0: Service Scaffold

**Tier:** 0 - Setup & Infrastructure
**Status:** Pending

## Context

Creating the new `apps/llm-orchestrator-service/` backend service following existing service patterns (auth-service, whatsapp-service).

## Problem Statement

Need to create the service scaffold with package.json, tsconfig.json, and Dockerfile before any other work can begin.

## Scope

**In Scope:**
- Create `apps/llm-orchestrator-service/` directory
- Create `package.json` with correct workspace dependencies
- Create `tsconfig.json` extending base config
- Create `Dockerfile` following existing pattern
- Create basic `src/index.ts` entry point

**Out of Scope:**
- Actual domain/infra/routes implementation (later tiers)
- Terraform configuration (0-1)
- Cloud Build configuration (0-2)

## Required Approach

1. Copy structure from existing service (e.g., whatsapp-service)
2. Update package name to `@intexuraos/llm-orchestrator-service`
3. Add workspace dependencies for new packages
4. Ensure TypeScript compilation works

## Step Checklist

- [ ] Create directory `apps/llm-orchestrator-service/`
- [ ] Create `package.json` with name `@intexuraos/llm-orchestrator-service`
- [ ] Add dependencies: fastify, @intexuraos/common-core, @intexuraos/http-server
- [ ] Create `tsconfig.json` extending `../../tsconfig.base.json`
- [ ] Create `Dockerfile` based on existing service pattern
- [ ] Create `src/index.ts` with placeholder
- [ ] Run `npm install` from root

## Definition of Done

- [ ] `npm run typecheck` passes for new service
- [ ] Docker build succeeds locally
- [ ] Service directory structure matches existing services

## Verification Commands

```bash
# From repo root
npm install
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service

# Docker build test
docker build -f apps/llm-orchestrator-service/Dockerfile -t test-llm-orch .
```

## Rollback Plan

Delete `apps/llm-orchestrator-service/` directory and revert `package-lock.json` changes.
