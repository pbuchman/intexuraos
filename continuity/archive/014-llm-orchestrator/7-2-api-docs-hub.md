# Task 7-2: Add to API Docs Hub

**Tier:** 7 (Final deployment task)

---

## Context Snapshot

- Research Agent service deployed (7-0, 7-1)
- api-docs-hub aggregates OpenAPI specs
- Need to add new service

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Add research-agent-service to the API docs hub so its OpenAPI spec is visible in the aggregated documentation.

---

## Scope

**In scope:**

- Update api-docs-hub config with new service
- Verify OpenAPI endpoint accessible

**Non-scope:**

- Deployment (done in 7-0, 7-1)

---

## Required Approach

### Step 1: Update config

Modify `apps/api-docs-hub/src/config.ts`:

```typescript
export const API_SERVICES = [
  // ... existing services
  {
    name: 'Research Agent',
    slug: 'research-agent',
    url: process.env.RESEARCH_AGENT_URL ?? 'http://localhost:8082',
    openApiPath: '/openapi.json',
  },
];
```

### Step 2: Add environment variable

Update the deployment configuration to include `RESEARCH_AGENT_URL` environment variable.

### Step 3: Verify locally

```bash
# Start research-agent-service
cd apps/research-agent-service
npm run dev

# In another terminal, verify OpenAPI
curl http://localhost:8082/openapi.json
```

---

## Step Checklist

- [ ] Update api-docs-hub config.ts
- [ ] Add RESEARCH_AGENT_URL to environment
- [ ] Verify OpenAPI endpoint locally
- [ ] Run verification commands

---

## Definition of Done

1. Config updated with new service
2. Environment variable added
3. OpenAPI spec accessible
4. `npm run typecheck` passes for api-docs-hub

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Revert changes to config.ts

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
