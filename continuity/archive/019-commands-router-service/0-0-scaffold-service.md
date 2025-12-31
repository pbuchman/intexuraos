# 0-0 Scaffold Service

## Tier

0 (Setup)

## Context

Create the initial commands-router service structure using `/create-service` skill.

## Problem

Need basic service scaffold with Fastify, health routes, OpenAPI, and proper monorepo integration.

## Scope

- Use `/create-service commands-router`
- Add `@google/generative-ai` dependency for Gemini
- Add `@intexuraos/infra-firestore` dependency

## Non-Scope

- Domain logic
- Routes implementation
- Terraform

## Approach

1. Run `/create-service commands-router` skill
2. Add additional dependencies to package.json
3. Verify service starts and health endpoint works

## Checklist

- [ ] Service scaffold created
- [ ] Dependencies added
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts service
- [ ] `curl localhost:8080/health` returns 200

## Definition of Done

Service starts, health endpoint responds, basic structure in place.

## Verification

```bash
cd apps/commands-router
npm run dev &
sleep 2
curl http://localhost:8080/health
kill %1
```

## Rollback

```bash
rm -rf apps/commands-router
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
