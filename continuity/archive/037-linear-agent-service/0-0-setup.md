# Task 0-0: Create Service Scaffolding

## Tier

0 (Setup/Diagnostics)

## Context

This is the first task - creating the basic service structure for `linear-agent`. Follow the patterns established by existing services, particularly `calendar-agent`.

## Problem Statement

Need to create the basic directory structure, package.json, Dockerfile, and tsconfig for the linear-agent service.

## Scope

### In Scope

- Create `apps/linear-agent/` directory structure
- Create `package.json` with correct dependencies
- Create `Dockerfile` following existing patterns
- Create `tsconfig.json` for the workspace
- Add service to root `tsconfig.json` references

### Out of Scope

- Actual implementation code (later tasks)
- Terraform configuration (next task)
- Cloud Build configuration (later task)

## Required Approach

1. **Read** `.claude/commands/create-service.md` for the complete service creation checklist
2. **Copy** structure from `apps/calendar-agent/` as template
3. **Create** the directory structure as specified
4. **Create** `package.json` with these dependencies:
   - `@linear/sdk` - Linear API client
   - `@intexuraos/common-core`, `@intexuraos/common-http`, `@intexuraos/http-contracts`, `@intexuraos/http-server`
   - `@intexuraos/infra-firestore` - For connection storage
   - `@intexuraos/llm-factory`, `@intexuraos/llm-common` - For extraction service
   - `@intexuraos/infra-sentry` - Error tracking
   - `fastify`, `pino`, `zod`
5. **Create** `Dockerfile` following exact pattern from create-service.md
6. **Create** `tsconfig.json` extending base config
7. **Update** root `tsconfig.json` to include the new service

## Step Checklist

- [ ] Create `apps/linear-agent/` directory
- [ ] Create `apps/linear-agent/package.json`
- [ ] Create `apps/linear-agent/Dockerfile`
- [ ] Create `apps/linear-agent/tsconfig.json`
- [ ] Create `apps/linear-agent/src/` placeholder directories
- [ ] Create minimal `apps/linear-agent/src/index.ts` (placeholder)
- [ ] Update root `tsconfig.json` with reference
- [ ] Run `pnpm install` to verify dependencies

## Definition of Done

- Directory structure exists matching template
- `pnpm install` completes without errors
- TypeScript compilation setup ready (even if files are placeholders)

## Verification Commands

```bash
# Check directory exists
ls -la apps/linear-agent/

# Check package.json is valid
cat apps/linear-agent/package.json | jq .

# Install dependencies
pnpm install

# Verify tsconfig reference added
grep "linear-agent" tsconfig.json
```

## Rollback Plan

```bash
rm -rf apps/linear-agent/
# Revert tsconfig.json changes
git checkout tsconfig.json
```

## Reference Files

- `.claude/commands/create-service.md` (lines 17-131)
- `apps/calendar-agent/package.json`
- `apps/calendar-agent/Dockerfile`
- `apps/calendar-agent/tsconfig.json`

## package.json Template

```json
{
  "name": "@intexuraos/linear-agent",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "node ../../scripts/build-service.mjs linear-agent",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
    "dev": "node --watch --experimental-strip-types src/index.ts"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/swagger": "^9.4.2",
    "@fastify/swagger-ui": "^5.2.1",
    "@intexuraos/common-core": "*",
    "@intexuraos/common-http": "*",
    "@intexuraos/http-contracts": "*",
    "@intexuraos/http-server": "*",
    "@intexuraos/infra-firestore": "*",
    "@intexuraos/infra-sentry": "*",
    "@intexuraos/llm-common": "*",
    "@intexuraos/llm-factory": "*",
    "@intexuraos/llm-pricing": "*",
    "@linear/sdk": "^29.0.0",
    "fastify": "^5.1.0",
    "pino": "^10.1.0",
    "zod": "^3.24.1"
  }
}
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
