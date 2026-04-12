# Legacy LLM Usage Logging Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all surviving legacy LLM usage artifacts — dead code, stale config fields, orphaned documentation, and ESLint rules for a deleted package — left behind after the INT-1342 Firestore migration.

**Architecture:** INT-1342 (child of INT-1338 epic) migrated all Firestore LLM usage writers to `llm-usage-service` HTTP, deleted `packages/llm-audit`, deleted the `user_usage` feature, and removed the `/settings/usage-costs` page. However, scattered remnants survive in orchestrator config interfaces, JSDoc comments, ESLint rules, and ~30+ documentation files. This plan performs a precise sweep.

**Tech Stack:** TypeScript, ESLint flat config, Markdown documentation, Vitest

---

## Background — What INT-1342 Already Cleaned Up

For context, INT-1342 (Track 3 of the INT-1338 epic) completed these deletions:

- **Part A+C:** Replaced `FirestoreUsageSink` with `HttpInternalAuthUsageSink` across all apps; deleted `packages/llm-audit` package entirely
- **Part B:** Deleted `user_usage` Firestore feature and rate limiting from `code-agent`
- **Part D:** Deleted `/settings/usage-costs` page and backend from web + app-settings-service
- **Part E:** Removed lingering `zai` type references
- **Final cleanup:** Dropped `llm_usage_stats` and `llm_api_logs` from `firestore-collections.json`

This plan addresses the artifacts that survived those deletions.

---

## Inventory of Remaining Artifacts

### Code-Level Remnants

| #   | Artifact                               | Location                                                                            | Description                                                                                                                                                             |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `auditLogPath` dead config field       | `workers/orchestrator/src/services/completion-verifier.ts:125`                      | Config interface field that is defined but never read by the implementation. The `OrchestratorFileAuditSink` that consumed it was deleted in INT-1342.                  |
| C2  | `auditLogPath` dead config field       | `workers/orchestrator/src/services/agent-compliance-validator.ts:262`               | Same — defined in `AgentComplianceValidatorConfig` but never accessed via `this.config.auditLogPath`.                                                                   |
| C3  | `llmAuditLogPath` dead variable        | `workers/orchestrator/src/start.ts:495`                                             | Creates a path `join(logsDir, 'llm-audit.log')` that is passed to the dead config fields above.                                                                         |
| C4  | `auditLogPath` in tests                | `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts:47,58`     | Test config includes the dead field.                                                                                                                                    |
| C5  | `auditLogPath` in tests                | `workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts:48` | Test config includes the dead field.                                                                                                                                    |
| C6  | Stale JSDoc comment                    | `packages/llm-contract/src/toolCalling.ts:51`                                       | Comment says "Logger, auditSink, and usageSink are baked into..." but `auditSink` no longer exists.                                                                     |
| C7  | `StructuredLogUsageSink` unused export | `packages/llm-pricing/src/usageLogger.ts:75-102`, `index.ts:7`                      | Class is exported but has zero external consumers (only used in its own test file). All production code now uses `HttpInternalAuthUsageSink` or `HttpWebhookUsageSink`. |
| C8  | `llm-audit` ESLint rules               | `eslint.config.js:67,102-121,146`                                                   | Import boundary rules for a deleted package.                                                                                                                            |

### Documentation Remnants

| #   | Artifact                          | Location                                                                                                        | Description                                                                                                     |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| D1  | Full `llm-audit` package docs     | `docs/packages/llm-audit/README.md`, `agent.md`, `technical-debt.md`                                            | 3 files documenting a package that no longer exists.                                                            |
| D2  | `llm-audit` in services index     | `docs/services/index.md:316`                                                                                    | Package listed in the packages table.                                                                           |
| D3  | `llm-audit` in architecture docs  | `docs/architecture/llm-packages.md:40,109`                                                                      | Listed in Mermaid diagram and has a section describing the package.                                             |
| D4  | `llm-audit` in package contracts  | `docs/architecture/package-contracts.md:72`                                                                     | Listed in the package contract table.                                                                           |
| D5  | `llm-audit` in site index         | `docs/site-index.json:1186-1196`                                                                                | 2 entries for the deleted package docs.                                                                         |
| D6  | `llm-audit` in documentation runs | `docs/documentation-runs.md:1404,1412-1414,1430`                                                                | Historical run entries referencing the package.                                                                 |
| D7  | Stale `llm-pricing` docs          | `docs/packages/llm-pricing/agent.md:12,31,118`                                                                  | References `FirestoreUsageSink`, `llm_usage_stats`, and outdated sink table.                                    |
| D8  | Stale `llm-pricing` README        | `docs/packages/llm-pricing/README.md:111-112`                                                                   | Lists `FirestoreUsageSink` and `StructuredLogUsageSink` in sink table.                                          |
| D9  | `user_usage` in code-agent docs   | `docs/services/code-agent/technical.md:383`                                                                     | Collection listed in Firestore table.                                                                           |
| D10 | Stale app-settings-service docs   | `docs/services/app-settings-service/technical.md:5,25,69,97,171,229,238,293,297`                                | Multiple references to `llm_usage_stats`, `usage-costs` endpoint, and `usageStatsRepository`.                   |
| D11 | Stale web service docs            | `docs/services/web/technical.md:223`                                                                            | Lists `/settings/usage-costs` route with `LlmCostsPage`.                                                        |
| D12 | Stale firestore validation        | `docs/validation/firestore-validation.md:41,42,57,101,119,155-173,230-231`                                      | References to `llm_api_logs`, `llm_usage_stats`, `user_usage` collections and their analysis sections (7a, 7b). |
| D13 | `llm-audit` in infra package docs | `docs/packages/infra-claude/README.md`, `agent.md`; similar for `infra-gpt`, `infra-gemini`, `infra-perplexity` | Reference `llm-audit` as a dependency.                                                                          |
| D14 | `llm-audit` in common-core docs   | `docs/packages/common-core/README.md`, `agent.md`                                                               | May reference `llm-audit` as a dependent.                                                                       |
| D15 | `llm-audit` in validation reports | `docs/validation/package-deps-validation.md`, `meta-validation-report.md`                                       | Validation results referencing deleted package.                                                                 |

---

## File Structure — What Changes

### Modified Files (Code)

| File                                                                             | Change                                                                        |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/completion-verifier.ts`                       | Remove `auditLogPath` from `CompletionVerifierConfig` interface               |
| `workers/orchestrator/src/services/agent-compliance-validator.ts`                | Remove `auditLogPath` from `AgentComplianceValidatorConfig` interface         |
| `workers/orchestrator/src/start.ts`                                              | Remove `llmAuditLogPath` variable and `auditLogPath` from both config objects |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`        | Remove `auditLogPath` from test config objects                                |
| `workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts` | Remove `auditLogPath` from test config object                                 |
| `packages/llm-contract/src/toolCalling.ts`                                       | Fix JSDoc: remove `auditSink` from comment                                    |
| `packages/llm-pricing/src/usageLogger.ts`                                        | Remove `StructuredLogUsageSink` class                                         |
| `packages/llm-pricing/src/index.ts`                                              | Remove `StructuredLogUsageSink` export                                        |
| `packages/llm-pricing/src/__tests__/usageLogger.test.ts`                         | Remove `StructuredLogUsageSink` tests                                         |
| `eslint.config.js`                                                               | Remove all `llm-audit` import boundary rules                                  |

### Deleted Files (Documentation)

| File                                        | Reason          |
| ------------------------------------------- | --------------- |
| `docs/packages/llm-audit/README.md`         | Package deleted |
| `docs/packages/llm-audit/agent.md`          | Package deleted |
| `docs/packages/llm-audit/technical-debt.md` | Package deleted |

### Modified Files (Documentation)

| File                                              | Change                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `docs/services/index.md`                          | Remove `llm-audit` row from packages table                                                                        |
| `docs/architecture/llm-packages.md`               | Remove `llm-audit` from Mermaid diagram and its section                                                           |
| `docs/architecture/package-contracts.md`          | Remove `llm-audit` row from contracts table                                                                       |
| `docs/site-index.json`                            | Remove 2 `llm-audit` entries                                                                                      |
| `docs/packages/llm-pricing/agent.md`              | Update sink table, remove `FirestoreUsageSink` references                                                         |
| `docs/packages/llm-pricing/README.md`             | Update sink table, remove `FirestoreUsageSink`                                                                    |
| `docs/services/code-agent/technical.md`           | Remove `user_usage` row from Firestore table                                                                      |
| `docs/services/app-settings-service/technical.md` | Remove all `llm_usage_stats`/`usage-costs` references                                                             |
| `docs/services/web/technical.md`                  | Remove `/settings/usage-costs` route row                                                                          |
| `docs/validation/firestore-validation.md`         | Remove `llm_api_logs`, `llm_usage_stats`, `user_usage` rows and sections 7a/7b                                    |
| `docs/packages/infra-*/README.md` and `agent.md`  | Remove `llm-audit` dependency references (8 files across infra-claude, infra-gpt, infra-gemini, infra-perplexity) |

### Untouched Files (Historical — Keep As-Is)

These files are historical plan/decision documents and should NOT be modified:
- `docs/plans/INT-1338-decisions.md`
- `docs/plans/INT-1342-track-3-firestore-migration.md`
- `docs/plans/INT-1341-track-2-orchestrator-usage-publisher.md`
- `docs/plans/INT-1340-track-1-llm-usage-web-ui.md`
- `docs/plans/INT-1343-track-5-move-pricing-ui.md`
- `docs/plans/INT-1011-openrouter-backend.md`
- `docs/plans/2026-03-09-execution-deep-validator.md`
- `docs/superpowers/specs/2026-04-09-usage-service-api-design.md`
- `docs/superpowers/plans/2026-03-12-zai-removal-glm5-finalization.md`
- `docs/documentation-runs.md` (historical log — do not edit)

---

### Task 1: Remove dead `auditLogPath` config from orchestrator

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:122-130`
- Modify: `workers/orchestrator/src/services/agent-compliance-validator.ts:258-267`
- Modify: `workers/orchestrator/src/start.ts:495,732,787`
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts:47,58`
- Modify: `workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts:48`

- [ ] **Step 1: Remove `auditLogPath` from `CompletionVerifierConfig`**

In `workers/orchestrator/src/services/completion-verifier.ts`, change the interface:

```typescript
// BEFORE:
export interface CompletionVerifierConfig {
  model: string;
  geminiApiKey: string;
  auditLogPath: string;
  codeAgentUrl: string;
  usageWebhookUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
}

// AFTER:
export interface CompletionVerifierConfig {
  model: string;
  geminiApiKey: string;
  codeAgentUrl: string;
  usageWebhookUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
}
```

- [ ] **Step 2: Remove `auditLogPath` from `AgentComplianceValidatorConfig`**

In `workers/orchestrator/src/services/agent-compliance-validator.ts`, change the interface:

```typescript
// BEFORE:
export interface AgentComplianceValidatorConfig {
  openRouterApiKey: string;
  model: string;
  pricing: ModelPricing;
  auditLogPath: string;
  codeAgentUrl: string;
  usageWebhookUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
}

// AFTER:
export interface AgentComplianceValidatorConfig {
  openRouterApiKey: string;
  model: string;
  pricing: ModelPricing;
  codeAgentUrl: string;
  usageWebhookUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
}
```

- [ ] **Step 3: Remove `llmAuditLogPath` variable and usages from `start.ts`**

In `workers/orchestrator/src/start.ts`:

1. Delete line 495: `const llmAuditLogPath = join(logsDir, 'llm-audit.log');`
2. Delete line 732: `auditLogPath: llmAuditLogPath,` (from `OrchestratorCompletionVerifier` config)
3. Delete line 787: `auditLogPath: llmAuditLogPath,` (from `OrchestratorAgentComplianceValidator` config)

- [ ] **Step 4: Remove `auditLogPath` from test config objects**

In `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`:
- Delete `auditLogPath: '/tmp/orchestrator-llm-audit.test.log',` from `defaultConfig` (line 47)
- Delete `auditLogPath: string;` from the `createVerifier` overrides type (line 58)

In `workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts`:
- Delete `auditLogPath: '/tmp/compliance-validator-audit.test.log',` from the config object (line 48)

- [ ] **Step 5: Run orchestrator tests to verify nothing breaks**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: All tests pass. The `auditLogPath` field was never read by implementation code — it was only carried in config objects.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts \
      workers/orchestrator/src/services/agent-compliance-validator.ts \
      workers/orchestrator/src/start.ts \
      workers/orchestrator/src/services/__tests__/completion-verifier.test.ts \
      workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts
git commit -m "refactor(orchestrator): remove dead auditLogPath config field

The OrchestratorFileAuditSink that consumed this field was deleted in
INT-1342 Part A+C. The field remained in config interfaces and was
passed through start.ts but never read by any implementation code.

Part of INT-1350."
```

---

### Task 2: Fix stale `auditSink` JSDoc in `llm-contract`

**Files:**
- Modify: `packages/llm-contract/src/toolCalling.ts:48-52`

- [ ] **Step 1: Update the JSDoc comment**

In `packages/llm-contract/src/toolCalling.ts`, change the comment:

```typescript
// BEFORE:
/**
 * Abstract tool calling client interface.
 *
 * Logger, auditSink, and usageSink are baked into the client instance
 * at factory creation time — callers do not pass them.
 */

// AFTER:
/**
 * Abstract tool calling client interface.
 *
 * Logger and usageSink are baked into the client instance
 * at factory creation time — callers do not pass them.
 */
```

- [ ] **Step 2: Run llm-contract tests**

Run: `pnpm run verify:workspace:tracked -- llm-contract`
Expected: All tests pass (comment-only change).

- [ ] **Step 3: Commit**

```bash
git add packages/llm-contract/src/toolCalling.ts
git commit -m "docs(llm-contract): remove stale auditSink JSDoc reference

The auditSink parameter was removed from all provider client factories
in INT-1342. Only usageSink remains.

Part of INT-1350."
```

---

### Task 3: Remove `StructuredLogUsageSink` (unused export)

**Files:**
- Modify: `packages/llm-pricing/src/usageLogger.ts:72-102`
- Modify: `packages/llm-pricing/src/index.ts:7`
- Modify: `packages/llm-pricing/src/__tests__/usageLogger.test.ts`

- [ ] **Step 1: Remove `StructuredLogUsageSink` class from `usageLogger.ts`**

In `packages/llm-pricing/src/usageLogger.ts`, delete the entire class (lines 72-102):

```typescript
// DELETE THIS ENTIRE BLOCK:
/**
 * Sink that emits usage payloads to structured logs.
 */
export class StructuredLogUsageSink implements UsageSink {
  readonly logger: Logger;

  constructor(deps: { logger: Logger }) {
    this.logger = deps.logger;
  }

  log(params: UsageLogParams): Promise<void> {
    this.logger.info(
      {
        usage: {
          userId: params.userId,
          provider: params.provider,
          model: params.model,
          callType: params.callType,
          inputTokens: params.usage.inputTokens,
          outputTokens: params.usage.outputTokens,
          totalTokens: params.usage.totalTokens,
          costUsd: params.usage.costUsd,
          success: params.success,
          ...(params.errorMessage !== undefined && { errorMessage: params.errorMessage }),
        },
      },
      'LLM usage sink log'
    );
    return Promise.resolve();
  }
}
```

- [ ] **Step 2: Remove the export from `index.ts`**

In `packages/llm-pricing/src/index.ts`, remove `StructuredLogUsageSink` from the export block:

```typescript
// BEFORE:
export {
  isUsageLoggingEnabled,
  UsageLogger,
  createUsageLogger,
  StructuredLogUsageSink,
  NoopUsageSink,
  type UsageLogParams,
  type CallType,
  type UsageSink,
} from './usageLogger.js';

// AFTER:
export {
  isUsageLoggingEnabled,
  UsageLogger,
  createUsageLogger,
  NoopUsageSink,
  type UsageLogParams,
  type CallType,
  type UsageSink,
} from './usageLogger.js';
```

- [ ] **Step 3: Remove `StructuredLogUsageSink` tests from test file**

In `packages/llm-pricing/src/__tests__/usageLogger.test.ts`:
1. Remove the `StructuredLogUsageSink` import from the import block.
2. Delete the entire `describe('StructuredLogUsageSink', ...)` block (the one containing the two tests: "emits usage payload to logger" and "includes errorMessage when present").

- [ ] **Step 4: Run llm-pricing tests and rebuild**

Run: `pnpm run verify:workspace:tracked -- llm-pricing`
Expected: All tests pass. No external consumer imports `StructuredLogUsageSink`.

- [ ] **Step 5: Run full CI to verify no downstream breakage**

Run: `pnpm run ci:tracked`
Expected: All workspaces pass. No workspace imports `StructuredLogUsageSink`.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-pricing/src/usageLogger.ts \
      packages/llm-pricing/src/index.ts \
      packages/llm-pricing/src/__tests__/usageLogger.test.ts
git commit -m "refactor(llm-pricing): remove unused StructuredLogUsageSink

This class had zero external consumers after INT-1342 migrated all
production code to HttpInternalAuthUsageSink and HttpWebhookUsageSink.
It was only referenced in its own test file.

Part of INT-1350."
```

---

### Task 4: Remove `llm-audit` from ESLint import boundary rules

**Files:**
- Modify: `eslint.config.js:67,102-121,146`

- [ ] **Step 1: Remove all `llm-audit` references from `eslint.config.js`**

There are 4 changes needed in `eslint.config.js`:

1. **Delete the type definition** (line 67):
   ```javascript
   // DELETE:
   { type: 'llm-audit', pattern: ['packages/llm-audit/src/**'], mode: 'folder' },
   ```

2. **Remove `llm-audit` from `infra-gemini` allow list** (lines 103-106):
   ```javascript
   // BEFORE:
   {
     from: 'infra-gemini',
     allow: ['infra-gemini', 'common-core', 'llm-audit', 'llm-contract', 'llm-pricing'],
   },
   // AFTER:
   {
     from: 'infra-gemini',
     allow: ['infra-gemini', 'common-core', 'llm-contract', 'llm-pricing'],
   },
   ```

3. **Remove `llm-audit` from `infra-claude` allow list** (lines 108-111):
   ```javascript
   // BEFORE:
   {
     from: 'infra-claude',
     allow: ['infra-claude', 'common-core', 'llm-audit', 'llm-contract', 'llm-pricing'],
   },
   // AFTER:
   {
     from: 'infra-claude',
     allow: ['infra-claude', 'common-core', 'llm-contract', 'llm-pricing'],
   },
   ```

4. **Remove `llm-audit` from `infra-gpt` allow list** (lines 113-116):
   ```javascript
   // BEFORE:
   {
     from: 'infra-gpt',
     allow: ['infra-gpt', 'common-core', 'llm-audit', 'llm-contract', 'llm-pricing'],
   },
   // AFTER:
   {
     from: 'infra-gpt',
     allow: ['infra-gpt', 'common-core', 'llm-contract', 'llm-pricing'],
   },
   ```

5. **Delete the entire `llm-audit` rule block** (lines 117-121):
   ```javascript
   // DELETE:
   // llm-audit can import from common-core and infra-firestore
   {
     from: 'llm-audit',
     allow: ['llm-audit', 'common-core', 'infra-firestore'],
   },
   ```

6. **Remove `llm-audit` from the aggregated allow list** (line 146):
   ```javascript
   // BEFORE:
   'llm-audit',
   // DELETE this entry from the array
   ```

- [ ] **Step 2: Verify lint still works**

Run: `pnpm run ci:tracked`
Expected: Lint passes. The deleted rules referenced a non-existent package — removing them is safe.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js
git commit -m "chore(eslint): remove llm-audit import boundary rules

Package was deleted in INT-1342 Part A+C. The ESLint rules for its
import boundaries were left behind.

Part of INT-1350."
```

---

### Task 5: Delete orphaned `llm-audit` documentation

**Files:**
- Delete: `docs/packages/llm-audit/README.md`
- Delete: `docs/packages/llm-audit/agent.md`
- Delete: `docs/packages/llm-audit/technical-debt.md`
- Modify: `docs/services/index.md:316`
- Modify: `docs/architecture/llm-packages.md:40,109`
- Modify: `docs/architecture/package-contracts.md:72`
- Modify: `docs/site-index.json:1186-1196`

- [ ] **Step 1: Delete the `docs/packages/llm-audit/` directory**

```bash
rm -rf docs/packages/llm-audit/
```

- [ ] **Step 2: Remove `llm-audit` row from `docs/services/index.md`**

Delete the row:
```markdown
| [llm-audit](../packages/llm-audit/README.md)       | LLM request/response audit trail in Firestore              |
```

- [ ] **Step 3: Remove `llm-audit` from `docs/architecture/llm-packages.md`**

1. Delete `LA2[llm-audit]` from the Mermaid diagram.
2. Delete the `#### @intexuraos/llm-audit` section and its content.
3. Remove any arrow lines in the diagram that reference `LA2`.

- [ ] **Step 4: Remove `llm-audit` row from `docs/architecture/package-contracts.md`**

Delete the row:
```markdown
| `@intexuraos/llm-audit`    | LLM API call audit logging to Firestore             |
```

- [ ] **Step 5: Remove `llm-audit` entries from `docs/site-index.json`**

Delete the two JSON objects for `llm-audit`:
```json
{
  "path": "packages/llm-audit/README.md",
  "title": "@intexuraos/llm-audit",
  "category": "packages",
  "description": "Package documentation: llm-audit"
},
{
  "path": "packages/llm-audit/technical-debt.md",
  "title": "@intexuraos/llm-audit — Technical Debt",
  "category": "packages",
  "description": "Technical debt notes for llm-audit"
},
```

- [ ] **Step 6: Commit**

```bash
git add -A docs/packages/llm-audit/ docs/services/index.md \
      docs/architecture/llm-packages.md docs/architecture/package-contracts.md \
      docs/site-index.json
git commit -m "docs: remove orphaned llm-audit package documentation

Package was deleted in INT-1342 Part A+C. Documentation, architecture
diagrams, site index entries, and contract table rows are now removed.

Part of INT-1350."
```

---

### Task 6: Update stale `llm-pricing` documentation

**Files:**
- Modify: `docs/packages/llm-pricing/agent.md:12,31,118`
- Modify: `docs/packages/llm-pricing/README.md:109-113`

- [ ] **Step 1: Update `docs/packages/llm-pricing/agent.md`**

1. Line 12 — change the Firestore row:
   ```markdown
   <!-- BEFORE: -->
   | Firestore | `llm_usage_stats` (owner: this package via `FirestoreUsageSink`)   |
   <!-- AFTER: -->
   | Firestore | None (usage events forwarded via `HttpInternalAuthUsageSink` to `llm-usage-service`) |
   ```

2. Lines 31-32 — update the sink table:
   ```markdown
   <!-- BEFORE: -->
   | `FirestoreUsageSink`     | Default sink — writes to `llm_usage_stats`               |
   | `StructuredLogUsageSink` | Sink that emits to a Pino logger                         |
   <!-- AFTER (replace both rows with): -->
   | `HttpInternalAuthUsageSink` | Default sink — forwards to `llm-usage-service` via HTTP  |
   | `HttpWebhookUsageSink`      | HMAC-signed sink for orchestrator → code-agent webhook   |
   ```

3. Line 118 — update the "Do NOT" guidance:
   ```markdown
   <!-- BEFORE: -->
   - Use `FirestoreUsageSink` in tests — use `NoopUsageSink` instead
   <!-- AFTER: -->
   - Use HTTP sinks in tests — use `NoopUsageSink` or `FakeUsageSink` instead
   ```

- [ ] **Step 2: Update `docs/packages/llm-pricing/README.md` sink table**

Lines 109-113:
```markdown
<!-- BEFORE: -->
| Sink                     | Destination                   | Use Case                            |
| ------------------------ | ----------------------------- | ----------------------------------- |
| `FirestoreUsageSink`     | Firestore `llm_usage_stats`   | Default for all production services |
| `StructuredLogUsageSink` | Pino logger (structured JSON) | Services without Firestore access   |
| `NoopUsageSink`          | /dev/null                     | Tests, disabled logging             |

<!-- AFTER: -->
| Sink                          | Destination                           | Use Case                                       |
| ----------------------------- | ------------------------------------- | ---------------------------------------------- |
| `HttpInternalAuthUsageSink`   | `llm-usage-service` via HTTP          | Default for all in-cluster production services |
| `HttpWebhookUsageSink`        | `code-agent` webhook (HMAC-signed)    | Orchestrator → code-agent → llm-usage-service  |
| `NoopUsageSink`               | /dev/null                             | Tests, disabled logging                        |
```

- [ ] **Step 3: Commit**

```bash
git add docs/packages/llm-pricing/agent.md docs/packages/llm-pricing/README.md
git commit -m "docs(llm-pricing): update sink documentation for HTTP-based usage logging

Replace references to deleted FirestoreUsageSink and StructuredLogUsageSink
with the current HttpInternalAuthUsageSink and HttpWebhookUsageSink.

Part of INT-1350."
```

---

### Task 7: Clean up stale service documentation

**Files:**
- Modify: `docs/services/code-agent/technical.md:383`
- Modify: `docs/services/app-settings-service/technical.md`
- Modify: `docs/services/web/technical.md:223`
- Modify: `docs/validation/firestore-validation.md`

- [ ] **Step 1: Remove `user_usage` from code-agent technical docs**

In `docs/services/code-agent/technical.md`, delete the row:
```markdown
| `user_usage`                    | code-agent | Per-user rate limit tracking                              |
```

- [ ] **Step 2: Update `app-settings-service` technical docs**

In `docs/services/app-settings-service/technical.md`, make these changes:

1. Update the overview paragraph (line 5) — remove mention of `llm_usage_stats`:
   ```markdown
   <!-- BEFORE: -->
   App-settings-service provides centralized LLM pricing configuration and user-specific usage cost analytics. It runs on Cloud Run (port 8122 locally) and depends on Firestore for pricing data (`settings/llm_pricing/providers`) and usage statistics (`llm_usage_stats` collection group).
   <!-- AFTER: -->
   App-settings-service provides centralized LLM pricing configuration. It runs on Cloud Run (port 8122 locally) and depends on Firestore for pricing data (`settings/llm_pricing/providers`). Usage cost analytics have been migrated to `llm-usage-service`.
   ```

2. Remove the `UsageColl` node from the Mermaid architecture diagram (line 25).

3. Remove the "Runtime: Usage Costs" sequence from the sequence diagram (lines 68-72).

4. Remove the `GET /settings/usage-costs` row from the public endpoints table (line 97).

5. Remove the usage stats Firestore path note (line 229).

6. Remove the `llm_usage_stats` row from the dependencies table (line 238).

7. Remove `usageStatsRepository.ts` from the file structure listing (line 291).

8. Remove the `usage-costs` reference from the test file listing (line 297).

- [ ] **Step 3: Remove `/settings/usage-costs` from web technical docs**

In `docs/services/web/technical.md`, delete the route row:
```markdown
| `/settings/usage-costs`                 | LlmCostsPage                      | Yes                             | LLM usage cost tracking              |
```

- [ ] **Step 4: Update firestore validation docs**

In `docs/validation/firestore-validation.md`:

1. Delete row 29 (`llm_api_logs`) from the collection inventory table.
2. Delete row 30 (`llm_usage_stats`) from the collection inventory table.
3. Delete row 45 (`user_usage`) from the collection inventory table.
4. Delete section "7a. `llm_api_logs`" entirely (lines 155-165).
5. Delete section "7b. `llm_usage_stats`" entirely (lines 167-173).
6. Remove the corresponding rows from the summary table at the bottom (lines 230-231).
7. Update the cross-service note about `app-settings-service` reading `llm_usage_stats` (line 101) — delete or note it's been removed.
8. Update the `user_usage` note in the `user_spend` analysis (lines 117-119) — remove the claim about `user_usage` superseding it.

- [ ] **Step 5: Commit**

```bash
git add docs/services/code-agent/technical.md \
      docs/services/app-settings-service/technical.md \
      docs/services/web/technical.md \
      docs/validation/firestore-validation.md
git commit -m "docs: remove stale references to deleted Firestore collections and endpoints

Remove references to llm_api_logs, llm_usage_stats, user_usage
collections and /settings/usage-costs endpoint from service documentation
and validation reports.

Part of INT-1350."
```

---

### Task 8: Remove `llm-audit` references from infra package docs

**Files:**
- Modify: `docs/packages/infra-claude/README.md` and `agent.md`
- Modify: `docs/packages/infra-gpt/README.md` and `agent.md`
- Modify: `docs/packages/infra-gemini/README.md` and `agent.md`
- Modify: `docs/packages/infra-perplexity/README.md` and `agent.md`

- [ ] **Step 1: Audit all 8 files for `llm-audit` references**

Run: `grep -rn "llm-audit\|llm_audit\|auditSink\|AuditSink\|audit" docs/packages/infra-{claude,gpt,gemini,perplexity}/`

For each match:
- If it says `llm-audit` is a dependency: remove it from the dependency list
- If it mentions `auditSink` parameter: remove or update the description
- If it describes audit logging behavior: update to reflect current behavior (no audit logging)

- [ ] **Step 2: Apply changes to each file**

In each `README.md` and `agent.md`:
- Remove `@intexuraos/llm-audit` from the Dependencies section
- Remove any `auditSink` parameter descriptions from factory function docs
- Update "Used By" or "Dependents" sections if they reference `llm-audit`

- [ ] **Step 3: Commit**

```bash
git add docs/packages/infra-claude/ docs/packages/infra-gpt/ \
      docs/packages/infra-gemini/ docs/packages/infra-perplexity/
git commit -m "docs(infra-*): remove llm-audit dependency references

The llm-audit package and auditSink parameter were deleted in INT-1342.
Update all four infra provider package docs to reflect current state.

Part of INT-1350."
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All workspaces pass.

- [ ] **Step 2: Verify no remaining stale references in source code**

Run:
```bash
grep -rn "llm-audit\|llm_audit\|FirestoreUsageSink\|auditSink\|auditLogPath\|llm_api_logs\|llm_usage_stats" --include="*.ts" --include="*.js" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  apps/ packages/ workers/ eslint.config.js firestore-collections.json
```

Expected: Zero matches (or only historical comments in migration files, which are immutable).

- [ ] **Step 3: Verify no remaining stale references in active docs**

Run:
```bash
grep -rn "llm-audit\|FirestoreUsageSink\|llm_api_logs\|llm_usage_stats\|user_usage\|usage-costs\|usageCosts\|LlmCostsPage" \
  docs/packages/ docs/services/ docs/architecture/ docs/validation/ docs/site-index.json docs/services/index.md
```

Expected: Zero matches. (Plan docs under `docs/plans/` and `docs/superpowers/` are historical and excluded.)

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All endpoints — this is a code/docs cleanup only

## Risk Assessment

**Risk: LOW.** All changes are:
- Removing dead config fields that were never read by implementation code
- Removing an exported class with zero external consumers
- Removing ESLint rules for a non-existent package
- Updating documentation to reflect already-completed code changes

No runtime behavior changes. No API surface changes. No Firestore operations.
