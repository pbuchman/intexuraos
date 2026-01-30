# Coverage Agent 3 - Strict Instructions

## Mission
Cover **113 uncovered branches** across 15 workspaces (remaining after Agent 1 and Agent 2).

## Your Scope (DO NOT TOUCH ANYTHING ELSE)

### apps/whatsapp-service (31 branches)
```
src/domain/whatsapp/usecases/transcribeAudio.ts:305
src/infra/firestore/messageRepository.ts:103
src/infra/firestore/userMappingRepository.ts:118
src/infra/speechmatics/adapter.ts:221,542,550
src/infra/whatsapp/sender.ts:114
src/routes/messageRoutes.ts:180
src/routes/pubsubRoutes.ts:261
src/routes/shared.ts:457,460,466,529,543
src/routes/webhookRoutes.ts:176,270,405,416,555,660,671,786,885,936,942,945,1014,1019,1111,1156,1230
```

### apps/calendar-agent (20 branches)
```
src/domain/useCases/generateCalendarPreview.ts:63,66,131,156,168,190
src/domain/useCases/processCalendarAction.ts:137,154,155,156,161,363
src/infra/firestore/calendarPreviewRepository.ts:176,179,182,185,188,191,197
src/routes/internalRoutes.ts:311
```

### apps/actions-agent (12 branches)
```
src/domain/usecases/handleApprovalReply.ts:122,133,245,687
src/infra/http/calendarServiceHttpClient.ts:163
src/infra/http/codeAgentHttpClient.ts:44,146
src/infra/http/notesServiceHttpClient.ts:70
src/infra/http/todosServiceHttpClient.ts:70
src/routes/internalRoutes.ts:748,749
src/routes/publicRoutes.ts:646
```

### apps/todos-agent (11 branches)
```
src/domain/usecases/reorderTodoItems.ts:63
src/domain/usecases/updateTodoItem.ts:18,69
src/infra/firestore/firestoreTodoRepository.ts:68
src/routes/todoRoutes.ts:320,378,432,455,490,506,565
```

### apps/user-service (10 branches)
```
src/domain/settings/formatLlmError.ts:140,167
src/infra/firestore/encryption.ts:75
src/routes/deviceRoutes.ts:94,210,303
src/routes/oauthConnectionRoutes.ts:86,94,136
src/routes/tokenRoutes.ts:101
```

### apps/web-agent (7 branches)
```
src/infra/linkpreview/openGraphFetcher.ts:225
src/infra/pagesummary/crawl4aiClient.ts:145
src/infra/pagesummary/pageContentFetcher.ts:126,161
src/infra/pagesummary/parseSummaryResponse.ts:94,136,197
```

### apps/notion-service (4 branches)
```
src/infra/firestore/notionConnectionRepository.ts:144
src/routes/integrationRoutes.ts:29
src/routes/internalRoutes.ts:195,204
```

### apps/mobile-notifications-service (4 branches)
```
src/infra/firestore/firestoreNotificationRepository.ts:202
src/infra/firestore/firestoreSignatureConnectionRepository.ts:82
src/routes/notificationRoutes.ts:114
src/routes/statusRoutes.ts:92
```

### apps/linear-agent (3 branches)
```
src/routes/linearRoutes.ts:307,308,309
```

### apps/bookmarks-agent (3 branches)
```
src/domain/usecases/summarizeBookmark.ts:103,112
src/infra/firestore/firestoreBookmarkRepository.ts:210
```

### packages/infra-sentry (1 branch)
```
src/fastify.ts:117
```

### packages/infra-perplexity (1 branch)
```
src/client.ts:165
```

### packages/internal-clients (1 branch)
```
src/user-service/client.ts:91
```

### apps/commands-agent (1 branch)
```
src/routes/internalRoutes.ts:173
```

### apps/app-settings-service (1 branch)
```
src/infra/firestore/usageStatsRepository.ts:86
```

### apps/image-service (1 branch)
```
src/infra/llm/GptPromptAdapter.ts:63
```

### workers/log-cleanup (1 branch)
```
src/cleanup.ts:4
```

### workers/vm-lifecycle (1 branch)
```
src/start-vm.ts:120
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
# Verify specific workspace
pnpm -w run verify:workspace:tracked <service-name>

# Run specific test file
cd apps/<service> && pnpm vitest run src/__tests__/<file>.test.ts

# Check coverage for specific file
cd apps/<service> && pnpm vitest run src/__tests__/<file>.test.ts --coverage
```

### Check remaining uncovered branches in your scope
```bash
node scripts/verify-v8-ignore.mjs --all 2>&1 > /tmp/v8-check.txt
rg "apps/whatsapp-service|apps/calendar-agent|apps/actions-agent|apps/todos-agent|apps/user-service|apps/web-agent|apps/notion-service|apps/mobile-notifications-service|apps/linear-agent|apps/bookmarks-agent|apps/commands-agent|apps/app-settings-service|apps/image-service|packages/infra-sentry|packages/infra-perplexity|packages/internal-clients|workers/log-cleanup|workers/vm-lifecycle" /tmp/v8-check.txt
```

---

## Exit Criteria (ALL MUST PASS)

1. **Zero uncovered branches in your scope:**
   ```bash
   node scripts/verify-v8-ignore.mjs --all 2>&1 > /tmp/v8-check.txt
   # Must show 0 branches for all services in scope
   ```

2. **Workspace verification passes for all services:**
   ```bash
   pnpm -w run verify:workspace:tracked <each-service>
   # All must show "All checks passed"
   ```

3. **v8 ignore validation passes:**
   ```bash
   pnpm -w run verify:v8-ignore
   # Must show "✓ N v8 ignore comments validated" with no errors
   ```

---

## Deliverables

1. All 113 branches either tested or properly exempted
2. All new tests pass
3. No changes to files outside your scope
4. Git commit with message: `INT-426 Cover remaining service branches`

---

## STRICT RULES

1. **DO NOT modify any files outside your scope**
2. **DO NOT modify vitest.config.ts or coverage thresholds**
3. **DO NOT use v8 ignore without valid category**
4. **DO NOT commit until exit criteria pass**
5. **DO NOT touch**: apps/research-agent, packages/llm-prompts, apps/code-agent, workers/orchestrator

---

## Work Order (Suggested - by branch count)

1. **Small services first (1-4 branches each):**
   - packages/infra-sentry, packages/infra-perplexity, packages/internal-clients
   - apps/commands-agent, apps/app-settings-service, apps/image-service
   - workers/log-cleanup, workers/vm-lifecycle
   - apps/linear-agent, apps/bookmarks-agent
   - apps/notion-service, apps/mobile-notifications-service

2. **Medium services (7-12 branches):**
   - apps/web-agent (7)
   - apps/user-service (10)
   - apps/todos-agent (11)
   - apps/actions-agent (12)

3. **Large services (20+ branches):**
   - apps/calendar-agent (20)
   - apps/whatsapp-service (31)

---

## Branch Information

You are working in: `feature/int-426` (main branch)
