# Coverage Agent 2 - Strict Instructions

## Mission
Cover **99 uncovered branches** across 2 workspaces: `apps/code-agent` (51) and `workers/orchestrator` (48).

## Your Scope (DO NOT TOUCH ANYTHING ELSE)

### apps/code-agent (51 branches)
```
src/domain/services/linearIssueService.ts:145
src/infra/webhookValidation.ts:90
src/infra/auth/jwtValidator.ts:54
src/infra/firestore/userUsageFirestoreRepository.ts:21,92,93,95,96,183,191,199
src/infra/repositories/firestoreCodeTaskRepository.ts:297,354,471
src/infra/services/taskDispatcherImpl.ts:281,296
src/infra/services/workerDiscoveryImpl.ts:101,102,150
src/routes/codeRoutes.ts:216,218,219,220,221,222,224,445,674,675,681,692,702,1041,1117,1120,1121,1283,1294,1472,1495,1497,1616
src/routes/webhookRoutes.ts:124,127,165,237,241,290,316,478,503
```

### workers/orchestrator (48 branches)
```
src/main.ts:52,54,220
src/routes.ts:36,43,120,121,122,123,124,125
src/start.ts:34,42,56,61,64,130,131,134,141,144
src/github/token-service.ts:134
src/services/log-forwarder.ts:103,108,156,166,244
src/services/task-dispatcher.ts:261,278,362,413,414,415,419,441,445,461,478
src/services/tmux-manager.ts:91
src/services/webhook-client.ts:66,85,127
src/services/worktree-manager.ts:58,81,96,99,150,174
```

---

## Decision Framework

For EACH uncovered branch line, decide:

### Option A: Write a Test
Use when the branch CAN be triggered via test setup (fake repositories, mock services, etc.)

### Option B: Add v8 Ignore Comment
Use when the branch CANNOT be tested due to:
- TypeScript type narrowing (`ts-type`)
- Fake/mock cannot produce required state (`test-infra`)
- Auth middleware tested elsewhere (`auth-guard`)
- Schema validation makes fallback unreachable (`schema`)
- Regex capture group guaranteed (`regex`)

**Format:** `/* v8 ignore <CATEGORY> -- <brief reason> */`

Valid categories: `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

---

## Testing Commands

```bash
# Verify ONLY your workspaces
pnpm -w run verify:workspace:tracked code-agent
pnpm -w run verify:workspace:tracked orchestrator

# Run specific test file
cd apps/code-agent && pnpm vitest run src/__tests__/<file>.test.ts

# Check coverage for specific file
cd apps/code-agent && pnpm vitest run src/__tests__/<file>.test.ts --coverage
```

### Check remaining uncovered branches in your scope
```bash
node scripts/verify-v8-ignore.mjs --all 2>&1 > /tmp/v8-check.txt
rg "apps/code-agent|workers/orchestrator" /tmp/v8-check.txt
```

---

## Exit Criteria (ALL MUST PASS)

1. **Zero uncovered branches in your scope:**
   ```bash
   node scripts/verify-v8-ignore.mjs --all 2>&1 > /tmp/v8-check.txt
   rg "apps/code-agent|workers/orchestrator" /tmp/v8-check.txt
   # Must return empty
   ```

2. **Workspace verification passes:**
   ```bash
   pnpm -w run verify:workspace:tracked code-agent
   pnpm -w run verify:workspace:tracked orchestrator
   # Both must show "All checks passed"
   ```

3. **v8 ignore validation passes:**
   ```bash
   pnpm -w run verify:v8-ignore
   # Must show "✓ N v8 ignore comments validated" with no errors
   ```

---

## Deliverables

1. All 99 branches either tested or properly exempted
2. All new tests pass
3. No changes to files outside your scope
4. Git commit with message: `INT-426 Cover code-agent and orchestrator branches`

---

## STRICT RULES

1. **DO NOT modify any files outside your scope**
2. **DO NOT modify vitest.config.ts or coverage thresholds**
3. **DO NOT use v8 ignore without valid category**
4. **DO NOT commit until exit criteria pass**
5. **DO NOT run full CI** - only verify your workspaces
6. **DO NOT touch**: apps/research-agent, packages/llm-prompts, apps/whatsapp-service, or other services

---

## Work Order (Suggested)

1. Start with `workers/orchestrator/src/services/` (smaller service files)
2. Move to `apps/code-agent/src/infra/` (repository/service tests)
3. Then `apps/code-agent/src/routes/` (integration tests)
4. Finally remaining orchestrator files

---

## Branch Information

You are working in: `feature/int-426-coverage-agent-2`
Base branch: `feature/int-426`
