# code-agent MVP Continuation Prompt

## Context

You are continuing work on the **code-agent** service for IntexuraOS. The foundation is complete (4/16 issues done), but the current implementation has route paths that don't match the design document.

**Branch:** `feature/INT-246`
**PR:** https://github.com/pbuchman/intexuraos/pull/603
**Design Document:** `docs/designs/INT-156-code-action-type.md`

---

## Immediate Priority: Route Path Alignment

Before proceeding with new issues, the existing routes must be corrected to match the design document.

### Current State (Wrong)

```
POST   /internal/code-tasks                           → Create task
GET    /internal/code-tasks/:taskId                   → Get task
GET    /internal/code-tasks                           → List tasks
PATCH  /internal/code-tasks/:taskId                   → Update task
GET    /internal/code-tasks/linear/:linearIssueId/active
GET    /internal/code-tasks/zombies
```

### Required State (Per Design)

```
POST   /internal/code/process                         → From actions-agent (internal)
POST   /code/submit                                   → From UI (public, Auth0 JWT)
GET    /code/tasks                                    → List tasks (public, Auth0 JWT)
GET    /code/tasks/:taskId                            → Get task (public, Auth0 JWT)
POST   /code/cancel                                   → Cancel task (public, Auth0 JWT)
POST   /internal/webhooks/task-complete               → From worker (HMAC)
POST   /internal/logs                                 → Log chunks from worker (HMAC)
```

### Alignment Steps

1. **Rename route file:** `codeTasksRoutes.ts` → `codeRoutes.ts`
2. **Split routes by auth type:**
   - Internal routes (X-Internal-Auth): `/internal/code/process`
   - Public routes (Auth0 JWT): `/code/*`
   - Webhook routes (HMAC): `/internal/webhooks/*`, `/internal/logs`
3. **Update tests** to use new paths
4. **Update OpenAPI spec** to reflect correct paths

---

## Issue Execution Order

After alignment, work through issues in this order (respecting dependencies):

| Priority | Issue   | Task                                 | Blocked By |
| -------- | ------- | ------------------------------------ | ---------- |
| 1        | INT-250 | Worker discovery and health checking | -          |
| 2        | INT-251 | Task dispatcher with HMAC signing    | INT-250    |
| 3        | INT-252 | POST /internal/code/process endpoint | INT-251    |
| 4        | INT-253 | POST /code/submit endpoint (UI)      | INT-251    |
| 5        | INT-254 | GET /code/tasks endpoints            | -          |
| 6        | INT-255 | POST /code/cancel endpoint           | INT-251    |
| 7        | INT-256 | Webhook handler + Log chunks         | -          |
| 8        | INT-257 | Status callback to actions-agent     | INT-256    |
| 9        | INT-258 | WhatsApp notifications               | INT-256    |
| 10       | INT-259 | Zombie task detection and recovery   | -          |
| 11       | INT-260 | Cost tracking and rate limiting      | -          |
| 12       | INT-262 | Integration tests                    | All above  |

---

## Workflow Instructions

Use the `/linear` skill to manage each issue:

```
/linear INT-250
```

This will:

1. Transition the issue to "In Progress"
2. Show you the full issue description with step-by-step instructions
3. Track your work

For each issue:

1. **Read the issue description** - It contains exact file paths, code snippets, and test requirements
2. **Read the design document section** referenced in the issue
3. **Implement step by step** - Don't skip steps
4. **Write tests first** - TDD is mandatory per CLAUDE.md
5. **Run `pnpm run ci:tracked`** - Must pass before marking done
6. **Commit with issue ID** - e.g., `INT-250 Add worker discovery service`

---

## Key Files

- **Design Document:** `docs/designs/INT-156-code-action-type.md`
- **Routes:** `apps/code-agent/src/routes/codeTasksRoutes.ts` (to be renamed)
- **Repository:** `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`
- **Models:** `apps/code-agent/src/domain/models/codeTask.ts`
- **Services:** `apps/code-agent/src/services.ts`

---

## Environment Variables Needed

These will be added as you implement each issue:

| Variable                          | Issue   | Purpose             |
| --------------------------------- | ------- | ------------------- |
| `INTEXURAOS_CF_CLIENT_ID`         | INT-250 | Cloudflare Access   |
| `INTEXURAOS_CF_CLIENT_SECRET`     | INT-250 | Cloudflare Access   |
| `INTEXURAOS_WORKER_MAC_URL`       | INT-250 | Mac worker endpoint |
| `INTEXURAOS_WORKER_VM_URL`        | INT-250 | VM worker endpoint  |
| `INTEXURAOS_DISPATCH_SECRET`      | INT-251 | HMAC signing        |
| `INTEXURAOS_ACTIONS_AGENT_URL`    | INT-257 | Status callbacks    |
| `INTEXURAOS_WHATSAPP_SERVICE_URL` | INT-258 | Notifications       |

---

## Start Command

Begin with the route alignment, then:

```
/linear INT-250
```

---

## Rules Reminder

1. **Design document is source of truth** - Don't guess, read it
2. **Test first** - Write failing test, then implement
3. **CI must pass** - `pnpm run ci:tracked` before any commit
4. **Own everything** - If you find issues, fix them
5. **One issue at a time** - Complete fully before moving on
