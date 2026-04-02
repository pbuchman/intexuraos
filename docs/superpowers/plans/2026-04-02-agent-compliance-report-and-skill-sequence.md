# Agent Compliance Report & Execution Skill Sequence Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the markdown-based Deep Validation Report with a structured JSON Agent Compliance Report via OpenRouter, and update the execution agent skill sequence to resolve the `executing-plans` / `subagent-driven-development` conflict and the `simplify` / `requesting-code-review` redundancy.

**Architecture:** The orchestrator's `execution-deep-validator.ts` is rewritten to use `@intexuraos/infra-openrouter` with `xiaomi/mimo-v2-pro` (configurable). The LLM returns structured JSON validated by Zod with a repair-prompt fallback. Reports are sent to code-agent via a new dedicated webhook endpoint and stored in Firestore as a subcollection of `code_tasks`. GitHub PR comments are rendered from the structured JSON for consistent formatting. The execution system prompt and completion verifier schema are updated to mandate `subagent-driven-development` as the first skill and remove `/simplify` as a separate step.

**Tech Stack:** TypeScript, Zod, `@intexuraos/infra-openrouter`, OpenRouter API (OpenAI-compatible), Firestore, `gh` CLI for PR comments.

---

## Endpoint Changes

- **Created:** `POST /internal/webhooks/compliance-report` (code-agent) — receives structured compliance report from orchestrator
- **Modified:** None
- **Removed:** None
- **Unchanged:** `POST /internal/webhooks/task-complete`, `POST /internal/webhooks/task-event`

---

### Task 1: Add `response_format` support to `infra-openrouter` client

The OpenRouter client's `generate()` method needs to support JSON mode via the OpenAI-compatible `response_format` parameter.

**Files:**
- Modify: `packages/infra-openrouter/src/client.ts:279-358`
- Modify: `packages/infra-openrouter/src/types.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing test for `generate` with `responseFormat`**

Add a test that calls `generate()` with a `responseFormat: { type: 'json_object' }` option and verifies the request body includes `response_format`.

```typescript
it('includes response_format in request body when provided', async () => {
  nockScope
    .post('/api/v1/chat/completions', (body: Record<string, unknown>) => {
      expect(body).toHaveProperty('response_format', { type: 'json_object' });
      return true;
    })
    .reply(200, validResponse);

  const client = createOpenRouterClient(defaultConfig);
  await client.generate('test', { responseFormat: { type: 'json_object' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/infra-openrouter && npx vitest run src/__tests__/client.test.ts --reporter=dot`
Expected: FAIL — `generate` does not accept options parameter.

- [ ] **Step 3: Add `GenerateOptions` type to `types.ts`**

```typescript
export interface GenerateOptions {
  responseFormat?: { type: 'json_object' | 'text' };
}
```

- [ ] **Step 4: Update `generate` method signature and request body in `client.ts`**

In `client.ts`, change the `generate` method to accept an optional second parameter:

```typescript
async generate(
  prompt: string,
  options?: GenerateOptions
): Promise<Result<GenerateResult, OpenRouterError>> {
```

In the `requestBody` construction, add:

```typescript
const requestBody = {
  model,
  messages: [{ role: 'user', content: prompt }],
  temperature: 0.2,
  ...(options?.responseFormat !== undefined && {
    response_format: options.responseFormat,
  }),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/infra-openrouter && npx vitest run src/__tests__/client.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 6: Write test that `generate` without options does NOT include `response_format`**

```typescript
it('does not include response_format when not provided', async () => {
  nockScope
    .post('/api/v1/chat/completions', (body: Record<string, unknown>) => {
      expect(body).not.toHaveProperty('response_format');
      return true;
    })
    .reply(200, validResponse);

  const client = createOpenRouterClient(defaultConfig);
  await client.generate('test');
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/infra-openrouter && npx vitest run src/__tests__/client.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 8: Update `LLMClient` interface in `llm-contract` if needed**

Check if `LLMClient.generate` is typed in `packages/llm-contract`. If the signature is strict (only `prompt: string`), update it to accept optional options. If it's already flexible or `infra-openrouter` uses `Pick<LLMClient, 'generate'>`, verify compatibility.

- [ ] **Step 9: Build and verify**

Run: `pnpm build`
Expected: Clean build with no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/infra-openrouter/src/client.ts packages/infra-openrouter/src/types.ts packages/infra-openrouter/src/__tests__/client.test.ts
git commit -m "feat(infra-openrouter): add response_format support to generate method"
```

---

### Task 2: Define Agent Compliance Report Zod schema

Create the structured report schema that replaces the markdown tables. This is a pure types/schema task with no runtime dependencies.

**Files:**
- Create: `workers/orchestrator/src/services/compliance-report-schema.ts`
- Test: `workers/orchestrator/src/services/__tests__/compliance-report-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { AgentComplianceReportSchema } from '../compliance-report-schema.js';

describe('AgentComplianceReportSchema', () => {
  it('validates a complete passing report', () => {
    const report = {
      claimVerification: {
        ciTrackedCalled: { called: true, exitCode: 0, msgRef: 'MSG-054' },
        prCreated: { created: true, url: 'https://github.com/pbuchman/intexuraos/pull/1234', msgRef: 'MSG-082' },
        commitCount: 1,
        summaryAccurate: true,
        summaryContradictions: [],
      },
      contractCompliance: {
        subagentDrivenDevInvoked: { invoked: true, msgRef: 'MSG-010' },
        requestingCodeReviewInvoked: { invoked: true, msgRef: 'MSG-060' },
        codeReviewerDispatched: { dispatched: true, msgRef: 'MSG-066' },
        correctOrder: true,
        skillViolations: [],
      },
      anomalies: [],
      executionMetrics: {
        totalMessages: 90,
        hookViolationCount: 3,
        toolErrorCount: 2,
        subagentDispatchCount: 4,
      },
    };
    const result = AgentComplianceReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });

  it('validates a report with anomalies', () => {
    const report = {
      claimVerification: {
        ciTrackedCalled: { called: true, exitCode: 0, msgRef: 'MSG-054' },
        prCreated: { created: false, url: null, msgRef: null },
        commitCount: 0,
        summaryAccurate: false,
        summaryContradictions: ['Claimed PR was created but no gh pr create in transcript'],
      },
      contractCompliance: {
        subagentDrivenDevInvoked: { invoked: false, msgRef: null },
        requestingCodeReviewInvoked: { invoked: false, msgRef: null },
        codeReviewerDispatched: { dispatched: false, msgRef: null },
        correctOrder: false,
        skillViolations: ['Neither mandatory skill was invoked'],
      },
      anomalies: [
        {
          type: 'fabrication',
          severity: 'critical',
          msgRef: 'MSG-120',
          description: 'Agent claimed CI passed but exit code was 1',
        },
        {
          type: 'ignored_error',
          severity: 'warning',
          msgRef: 'MSG-045',
          description: 'Edit tool returned error, agent did not retry',
        },
      ],
      executionMetrics: {
        totalMessages: 45,
        hookViolationCount: 0,
        toolErrorCount: 1,
        subagentDispatchCount: 0,
      },
    };
    const result = AgentComplianceReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });

  it('rejects report with invalid anomaly type', () => {
    const report = {
      claimVerification: {
        ciTrackedCalled: { called: false, exitCode: null, msgRef: null },
        prCreated: { created: false, url: null, msgRef: null },
        commitCount: 0,
        summaryAccurate: true,
        summaryContradictions: [],
      },
      contractCompliance: {
        subagentDrivenDevInvoked: { invoked: false, msgRef: null },
        requestingCodeReviewInvoked: { invoked: false, msgRef: null },
        codeReviewerDispatched: { dispatched: false, msgRef: null },
        correctOrder: false,
        skillViolations: [],
      },
      anomalies: [{ type: 'unknown_type', severity: 'critical', msgRef: 'MSG-001', description: 'test' }],
      executionMetrics: {
        totalMessages: 10,
        hookViolationCount: 0,
        toolErrorCount: 0,
        subagentDispatchCount: 0,
      },
    };
    const result = AgentComplianceReportSchema.safeParse(report);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && npx vitest run src/services/__tests__/compliance-report-schema.test.ts --reporter=dot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

```typescript
import { z } from 'zod';

const SeveritySchema = z.enum(['critical', 'warning', 'minor', 'pass']);

const AnomalyTypeSchema = z.enum([
  'fabrication',
  'ignored_error',
  'laziness',
  'wrong_conclusion',
  'permission_bypass',
  'hook_violation_storm',
  'degenerate_loop',
  'skill_substitution',
]);

const NullableMsgRef = z.string().nullable();

const ClaimVerificationSchema = z.object({
  ciTrackedCalled: z.object({
    called: z.boolean(),
    exitCode: z.number().nullable(),
    msgRef: NullableMsgRef,
  }),
  prCreated: z.object({
    created: z.boolean(),
    url: z.string().nullable(),
    msgRef: NullableMsgRef,
  }),
  commitCount: z.number().int().min(0),
  summaryAccurate: z.boolean(),
  summaryContradictions: z.array(z.string()),
});

const ContractComplianceSchema = z.object({
  subagentDrivenDevInvoked: z.object({
    invoked: z.boolean(),
    msgRef: NullableMsgRef,
  }),
  requestingCodeReviewInvoked: z.object({
    invoked: z.boolean(),
    msgRef: NullableMsgRef,
  }),
  codeReviewerDispatched: z.object({
    dispatched: z.boolean(),
    msgRef: NullableMsgRef,
  }),
  correctOrder: z.boolean(),
  skillViolations: z.array(z.string()),
});

const AnomalySchema = z.object({
  type: AnomalyTypeSchema,
  severity: SeveritySchema,
  msgRef: z.string(),
  description: z.string(),
});

const ExecutionMetricsSchema = z.object({
  totalMessages: z.number().int().min(0),
  hookViolationCount: z.number().int().min(0),
  toolErrorCount: z.number().int().min(0),
  subagentDispatchCount: z.number().int().min(0),
});

export const AgentComplianceReportSchema = z.object({
  claimVerification: ClaimVerificationSchema,
  contractCompliance: ContractComplianceSchema,
  anomalies: z.array(AnomalySchema),
  executionMetrics: ExecutionMetricsSchema,
});

export type AgentComplianceReport = z.infer<typeof AgentComplianceReportSchema>;
export type ComplianceAnomaly = z.infer<typeof AnomalySchema>;
export type ComplianceSeverity = z.infer<typeof SeveritySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/orchestrator && npx vitest run src/services/__tests__/compliance-report-schema.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/compliance-report-schema.ts workers/orchestrator/src/services/__tests__/compliance-report-schema.test.ts
git commit -m "feat(orchestrator): add Agent Compliance Report Zod schema"
```

---

### Task 3: Rewrite the validator — `agent-compliance-validator.ts`

Replace `execution-deep-validator.ts` with a new file that uses OpenRouter, JSON output, Zod validation, and repair-prompt fallback. Keep the old file until Task 8 removes all references.

**Files:**
- Create: `workers/orchestrator/src/services/agent-compliance-validator.ts`
- Test: `workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts`

**Dependencies:** Task 1 (response_format support), Task 2 (Zod schema)

- [ ] **Step 1: Write the failing test for the prompt builder**

Test that `buildCompliancePrompt` produces a prompt containing the claims JSON, the transcript, and instructions to return JSON matching the schema.

```typescript
import { describe, it, expect } from 'vitest';
import { buildCompliancePrompt } from '../agent-compliance-validator.js';

describe('buildCompliancePrompt', () => {
  it('includes agent claims as JSON', () => {
    const prompt = buildCompliancePrompt({
      formattedTranscript: '[MSG-001] ASSISTANT tool_use: Skill(superpowers:subagent-driven-development)',
      agentClaims: {
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/100',
        summary: 'test summary',
      },
      workerType: 'auto',
    });
    expect(prompt).toContain('"outcome": "implemented"');
    expect(prompt).toContain('MSG-001');
    expect(prompt).toContain('Agent Compliance Report');
    expect(prompt).toContain('claimVerification');
    expect(prompt).toContain('contractCompliance');
    expect(prompt).toContain('anomalies');
  });

  it('includes transcript-too-long marker when transcript exceeds limit', () => {
    const longTranscript = 'x'.repeat(800_001);
    const prompt = buildCompliancePrompt({
      formattedTranscript: longTranscript,
      agentClaims: {
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: '',
      },
      workerType: 'auto',
    });
    expect(prompt).toContain('TRANSCRIPT_TOO_LONG');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && npx vitest run src/services/__tests__/agent-compliance-validator.test.ts --reporter=dot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildCompliancePrompt`**

The prompt:
- Instructs the LLM to return ONLY valid JSON matching the `AgentComplianceReport` schema.
- Includes the full schema shape as a JSON example.
- Includes the agent claims JSON.
- Includes the formatted transcript.
- Checks transcript length: if > 180K tokens (~720K chars at ~4 chars/token), return early with a `TRANSCRIPT_TOO_LONG` marker instead of building the full prompt.
- Sections: Claim Verification (verify outcome, CI, PR, summary against transcript), Contract Compliance (check `subagent-driven-development` first, `requesting-code-review` second, code-reviewer dispatched), Anomalies (fabrication, ignored errors, laziness, wrong conclusions).
- Uses the `AGENT_COMPLIANCE_PROMPT_VERSION` constant (start at `1.0.0`).

The prompt should NOT include the "Plan vs Reality" section.

The contract check should mandate:
1. `superpowers:subagent-driven-development` must be invoked first (or `superpowers:executing-plans` as fallback for older tasks)
2. `superpowers:requesting-code-review` must be invoked after implementation
3. After `requesting-code-review`, a code-reviewer subagent must be dispatched

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Write the failing test for the validator class**

Test that `AgentComplianceValidator.validate()` calls the OpenRouter client, parses JSON, validates with Zod, and posts a GitHub PR comment.

Use a fake/mock for the OpenRouter client that returns valid JSON matching the schema. Verify:
- The PR comment is posted via `gh pr comment`
- The method returns the structured report
- `response_format: { type: 'json_object' }` is passed to `generate()`

- [ ] **Step 6: Implement `AgentComplianceValidator` class**

Interface:

```typescript
export interface AgentComplianceValidatorConfig {
  openRouterApiKey: string;
  model: string;
  pricing: ModelPricing;
  auditLogPath: string;
}

export interface ComplianceValidationInput {
  taskId: string;
  prNumber: number;
  repository: string;
  formattedTranscript: string;
  agentClaims: ExecutionAgentClaims;
  workerType: string;
}

export interface ComplianceValidationResult {
  report: AgentComplianceReport;
  model: string;
  promptVersion: string;
  costUsd: number;
  transcriptTooLong: boolean;
}

export interface AgentComplianceValidator {
  validate(
    input: ComplianceValidationInput,
    onProgress?: (message: string) => void
  ): Promise<ComplianceValidationResult | null>;
}
```

Flow:
1. Check transcript length. If > 720,000 chars (~180K tokens), return `{ transcriptTooLong: true }` result with empty report fields and post a GitHub comment saying "Transcript too long for compliance validation (X chars > 720K limit)".
2. Build prompt via `buildCompliancePrompt()`.
3. Call `openRouterClient.generate(prompt, { responseFormat: { type: 'json_object' } })`.
4. Parse response as JSON, validate with `AgentComplianceReportSchema.safeParse()`.
5. If Zod fails: build a repair prompt (include the invalid response + Zod error message), call `generate()` again. If second attempt fails, log warning and return `null`.
6. Render markdown from structured report (new function: `renderComplianceMarkdown`).
7. Post PR comment via `gh pr comment` (same `execFileAsync` pattern as current).
8. Return `ComplianceValidationResult`.

- [ ] **Step 7: Write test for the repair prompt flow**

Test that when the first LLM response fails Zod validation, the validator sends a repair prompt and succeeds on the second attempt.

- [ ] **Step 8: Implement the repair prompt**

Follow the pattern from `apps/research-agent/src/infra/llm/InputValidationAdapter.ts:135-200`:
- Log the parse error with `createLlmParseError` / `logLlmParseError` (from `@intexuraos/llm-utils`).
- Build repair prompt: include the original prompt summary, the invalid response, and the Zod error message.
- Call `generate()` again.
- Parse + validate again. If still fails, return `null`.

- [ ] **Step 9: Write test for `renderComplianceMarkdown`**

Verify that the function produces consistent markdown tables from a structured report. The output should have:
- `@ignore` prefix
- `### Agent Compliance Report — IntexuraOS` heading
- `**Cost:** $X.XX` and `**Model:** xiaomi/mimo-v2-pro`
- Tables for each section with emoji severity indicators

- [ ] **Step 10: Implement `renderComplianceMarkdown`**

Pure function: `AgentComplianceReport → string`. Uses the same severity emojis (🔴 Critical, 🟠 Warning, 🟡 Minor, 🟢 Pass). Tables are built programmatically — no LLM format drift possible.

- [ ] **Step 11: Run all tests**

Run: `cd workers/orchestrator && npx vitest run src/services/__tests__/agent-compliance-validator.test.ts --reporter=dot`
Expected: All PASS.

- [ ] **Step 12: Commit**

```bash
git add workers/orchestrator/src/services/agent-compliance-validator.ts workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts
git commit -m "feat(orchestrator): add Agent Compliance Validator with OpenRouter + Zod + repair"
```

---

### Task 4: Update execution system prompt and completion verifier schema

Update the mandatory skill sequence in the execution prompt and the `EXECUTION_SCHEMA` + `ExecutionAgentData` in the completion verifier.

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:223-367`
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:56-61,116-122`
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Test: `workers/orchestrator/src/__tests__/completion-verifier.test.ts`

- [ ] **Step 1: Update the execution prompt**

In `system-prompt.ts`, within the `executionPrompt.build()` method:

**Change the "Mandatory Skill Order" section (lines 290-294) to:**

```
### Mandatory Skill Order (non-negotiable)
1. Start with \`superpowers:subagent-driven-development\` (mandatory first skill) — dispatches fresh subagents per task with built-in spec + quality review
2. After implementation, run \`superpowers:requesting-code-review\` (mandatory second skill) — final holistic review of the complete change

You must provide output evidence that shows this order occurred.
```

**Change the "Implementation Flow" section (lines 303-309) to:**

```
### Implementation Flow (strict order)
1. Use \`superpowers:subagent-driven-development\` to execute the plan — this handles TDD, per-task review, and commits.
2. Run \`pnpm run ci:tracked\` — must pass.
3. Run the code review loop using \`superpowers:requesting-code-review\`.
4. ${implementationFlowStep5}
```

This removes `/simplify` as a separate step (its concerns are covered by `subagent-driven-development`'s per-task quality review).

**Update the EXECUTION_AGENT_FINAL block (lines 347-364):**

Replace `superpowers_executing_plans_used: <0|1>` with `superpowers_subagent_driven_dev_used: <0|1>`.

Replace `Skill sequence proof: <evidence that superpowers:executing-plans happened before superpowers:requesting-code-review>` with `Skill sequence proof: <evidence that superpowers:subagent-driven-development happened before superpowers:requesting-code-review>`.

**Bump version to `7.0.0`** (major — behavior change in mandatory skill sequence).

- [ ] **Step 2: Update `EXECUTION_SCHEMA` in completion verifier**

In `completion-verifier.ts:116-122`, change:

```typescript
export const EXECUTION_SCHEMA = z.object({
  outcome: z.enum(['implemented', 'already_completed']),
  superpowers_subagent_driven_dev: z.enum(['used', 'not used']),
  superpowers_requesting_code_review: z.enum(['used', 'not used']),
  gh_pr_url: z.string(),
  summary: z.string(),
});
```

- [ ] **Step 3: Update `ExecutionAgentData` interface**

In `completion-verifier.ts:56-61`, change:

```typescript
export interface ExecutionAgentData {
  agentType: 'execution';
  outcome: 'implemented' | 'already_completed';
  superpowers_subagent_driven_dev: 'used' | 'not used';
  superpowers_requesting_code_review: 'used' | 'not used';
  gh_pr_url: string;
  summary: string;
}
```

- [ ] **Step 4: Update all references to `superpowers_executing_plans`**

Search for `superpowers_executing_plans` across the codebase and update every reference:
- `execution-deep-validator.ts` prompt text (line 103) — will be deleted in Task 8, but update if needed for interim
- `task-dispatcher.ts` — check if it references the field name
- Test files — update mocks and assertions
- `apps/code-agent` — check if the webhook handler or Firestore storage references this field

Run: `rg "superpowers_executing_plans" --type ts` to find all occurrences.

- [ ] **Step 5: Update tests**

Update `system-prompt.test.ts` assertions to expect `subagent-driven-development` instead of `executing-plans`.

Update `completion-verifier.test.ts` to use `superpowers_subagent_driven_dev` in mock data and assertions.

- [ ] **Step 6: Run verification**

Run: `pnpm run verify:workspace:tracked orchestrator`
Expected: All typecheck, lint, tests pass.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/ workers/orchestrator/src/__tests__/
git commit -m "feat(orchestrator)!: update execution skill sequence to subagent-driven-development v7.0.0"
```

---

### Task 5: Add `INTEXURAOS_OPENROUTER_APP_API_KEY` env var

Add the new env var to the three required locations and wire it into the orchestrator startup.

**Files:**
- Modify: `workers/orchestrator/src/start.ts:748-766`
- Modify: `ecosystem.config.cjs`
- Modify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Add env var to `ecosystem.config.cjs`**

Add after the `INTEXURAOS_DASHSCOPE_APP_API_KEY` line:

```javascript
INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
```

- [ ] **Step 2: Add env var to terraform**

In `terraform/environments/dev/main.tf`, find the orchestrator module's `env_vars` block and add:

```hcl
{
  name  = "INTEXURAOS_OPENROUTER_APP_API_KEY"
  value = var.openrouter_app_api_key
}
```

Add the corresponding variable if it doesn't exist. Check how other API keys (GEMINI, MINIMAX, DASHSCOPE) are handled in terraform for the pattern to follow.

- [ ] **Step 3: Wire into orchestrator startup**

In `start.ts`, after the `executionDeepValidator` construction (line 748-752), replace it with:

```typescript
const openRouterApiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '';
const agentComplianceValidator = openRouterApiKey !== ''
  ? new OrchestratorAgentComplianceValidator(logger, {
      openRouterApiKey,
      model: process.env['INTEXURAOS_COMPLIANCE_MODEL'] ?? 'xiaomi/mimo-v2-pro',
      pricing: {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 3.0,
      },
      auditLogPath: llmAuditLogPath,
    })
  : undefined;
```

Note: the model and pricing are configurable via env vars. If `INTEXURAOS_OPENROUTER_APP_API_KEY` is not set, compliance validation is skipped (same graceful degradation as current deep validator).

Pass `agentComplianceValidator` to `TaskDispatcher` instead of `executionDeepValidator`.

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/start.ts ecosystem.config.cjs terraform/environments/dev/main.tf
git commit -m "feat(orchestrator): add INTEXURAOS_OPENROUTER_APP_API_KEY env var and wire compliance validator"
```

---

### Task 6: Create code-agent webhook endpoint for compliance reports

Add a new internal webhook endpoint that receives structured compliance reports from the orchestrator and stores them in Firestore.

**Files:**
- Create: `apps/code-agent/src/routes/webhooks/complianceReport.ts`
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (register the new route)
- Modify: `firestore-collections.json` (add subcollection documentation)
- Test: `apps/code-agent/src/__tests__/routes/webhooks/complianceReport.test.ts`

- [ ] **Step 1: Write the failing test**

Test that `POST /internal/webhooks/compliance-report` with a valid payload stores the report in Firestore under `code_tasks/{taskId}/compliance_reports/{reportId}`.

Use the `app.inject()` pattern with `setServices({ fakes })`.

The payload shape:

```typescript
interface ComplianceReportWebhookBody {
  taskId: string;
  prNumber: number;
  report: AgentComplianceReport;
  model: string;
  promptVersion: string;
  costUsd: number;
  workerType: string;
  transcriptTooLong: boolean;
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route handler**

The handler:
1. Validates internal auth (same pattern as `task-complete` webhook).
2. Validates HMAC signature (same pattern).
3. Parses the body.
4. Stores in Firestore: `code_tasks/{taskId}/compliance_reports/{auto-id}` with fields:
   - All fields from the webhook body
   - `createdAt: FieldValue.serverTimestamp()`
5. Returns `200 OK`.

- [ ] **Step 4: Register the route in `webhookRoutes.ts`**

Import and call the registration function from within the webhook routes file.

- [ ] **Step 5: Update `firestore-collections.json`**

Add `compliance_reports` to the `code_tasks` subcollections array:

```json
"code_tasks": {
  "owner": "code-agent",
  "description": "Code execution tasks",
  "subcollections": ["logs", "log_lines", "turn_metrics", "compliance_reports"]
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm run verify:workspace:tracked code-agent`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/complianceReport.ts apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks/complianceReport.test.ts firestore-collections.json
git commit -m "feat(code-agent): add /internal/webhooks/compliance-report endpoint with Firestore storage"
```

---

### Task 7: Wire orchestrator to send compliance report via webhook

Replace the fire-and-forget deep validation flow with the new compliance validator that sends the report to code-agent via the new webhook endpoint.

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Dependencies:** Task 3 (validator), Task 5 (env var), Task 6 (webhook endpoint)

- [ ] **Step 1: Update `prepareDeepValidationInput` → `prepareComplianceValidationInput`**

Rename the method. Update the input type from `DeepValidationInput` to `ComplianceValidationInput`. Remove `linearIssueBody` and `planContent` fields (no longer needed — we dropped "Plan vs Reality").

- [ ] **Step 2: Update `executeDeepValidation` → `executeComplianceValidation`**

Rename the method. Change the flow:
1. Call `agentComplianceValidator.validate(input)` — this is now blocking (not fire-and-forget).
2. If result is `null` (validation failed), log and skip.
3. If result is not null, send the structured report to code-agent via `webhookClient.send()` to the new `/internal/webhooks/compliance-report` endpoint.
4. The GitHub PR comment is already posted by the validator itself.

The webhook URL: derive from the existing `task.webhookUrl` by replacing `/internal/webhooks/task-complete` with `/internal/webhooks/compliance-report`.

- [ ] **Step 3: Update the call site in `handleTaskCompletion`**

In the verification-passed branch (around line 1106-1117):
- Change `deepValInput` to `complianceInput`.
- The compliance validation should still run AFTER `finalizeTaskWithResult` (keep fire-and-forget pattern for the webhook — the report is not needed for task completion).
- But the PR comment posting and the webhook to code-agent happen together in `executeComplianceValidation`.

- [ ] **Step 4: Update constructor to accept `AgentComplianceValidator` instead of `ExecutionDeepValidator`**

- [ ] **Step 5: Update tests**

Update task-dispatcher tests that mock the deep validator to use the new interface. Update the mock to return `ComplianceValidationResult`.

- [ ] **Step 6: Run verification**

Run: `pnpm run verify:workspace:tracked orchestrator`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat(orchestrator): wire Agent Compliance Validator into task completion flow"
```

---

### Task 8: Remove old deep validation code

Clean up the old `execution-deep-validator.ts` and all its references.

**Files:**
- Delete: `workers/orchestrator/src/services/execution-deep-validator.ts`
- Delete: `workers/orchestrator/src/services/__tests__/execution-deep-validator.test.ts`
- Modify: any remaining import references

**Dependencies:** Task 7 (all references updated)

- [ ] **Step 1: Search for remaining references**

Run: `rg "execution-deep-validator|ExecutionDeepValidator|DeepValidationInput|DEEP_VALIDATION" --type ts` and list all files.

- [ ] **Step 2: Remove or update each reference**

- [ ] **Step 3: Delete the old files**

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass.

- [ ] **Step 5: Commit**

```bash
git rm workers/orchestrator/src/services/execution-deep-validator.ts workers/orchestrator/src/services/__tests__/execution-deep-validator.test.ts
git commit -m "refactor(orchestrator): remove old Deep Validation Report code"
```

---

### Task 9: Final CI and verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: Clean build.

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All typecheck, lint, test, coverage, v8-ignore checks pass.

- [ ] **Step 3: Verify no remaining references to old naming**

Run: `rg "Deep Validation Report|deep.validation|DEEP_VALIDATION_PROMPT" --type ts`
Expected: No matches in `workers/orchestrator/src/` (docs/data files are fine to keep for historical records).

- [ ] **Step 4: Commit any final fixes**

If CI surfaced issues, fix and commit.
