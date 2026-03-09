# GitHub Agent & Tool Calling Architecture — Design

**Date:** 2026-03-08
**Linear:** INT-743
**Scope:** `packages/llm-contract`, `packages/llm-factory`, `packages/infra-gemini`, `packages/internal-clients`, `apps/code-agent`, `workers/orchestrator`, `apps/web`
**Architecture diagram:** https://intexuraos.cloud/share/claude/github-agent-architecture.html

## Problem

Code-agent receives GitHub webhook events (pull_request, workflow, etc.) but can only route them through hardcoded rules (`GitHubWebhookRules`). There's no LLM-powered decision-making for what actions to take. Specifically, there's no mechanism to automatically dispatch code reviews when PRs touch the web app.

Additionally, the codebase has no tool calling infrastructure — all LLM usage is simple text-in/text-out via `LlmGenerateClient.generate(prompt)`.

## Solution

### Three-Layer Agent Hierarchy

| Layer | Name             | Location                       | Role                                                                                                         |
| ----- | ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1     | GitHub Agent     | apps/code-agent                | LLM decision-maker. Receives event + diff, decides what to dispatch via native tool calling. Fast (seconds). |
| 2     | Review Agent     | workers/orchestrator           | Coordinator. Decides which subagents to spawn based on PR scope. Runs in Docker via Claude CLI.              |
| 3     | Review Subagents | workers/orchestrator (spawned) | Specialists. Each posts own GH comment (POST "working...", PATCH findings). Review-only, never commits.      |

### Key Decisions

1. **Native tool calling** — Gemini function calling protocol, not JSON parsing from prompts
2. **Await-and-report tool callbacks** — Tool `run` callbacks dispatch to orchestrator, await the HTTP response to report status back to the LLM, then the loop completes. The orchestrator processes asynchronously after accepting the task.
3. **GitHub Agent always posts comment** — After loop, code-agent posts GH comment about dispatch decision, even when no review dispatched (audit trail + visibility into agent reasoning)
4. **Review Agent decides subagents** — Code-agent says `request_review(frontend)`, review agent picks dimensions
5. **Each subagent posts own comment** — POST "working...", PATCH with findings (per-subagent)
6. **ToolCallingModel is a narrowed subset of LLMModel** — `Gemini25Flash` already exists in `LLMModel` (so `getProviderForModel()` works out of the box). `ToolCallingModel` is a new type alias that restricts which models can be used for agent loops. `'gemini-2.5-flash'` only for MVP, platform key fallback.
7. **Strict package dependency** — code-agent never imports `@google/genai`
8. **Unified ToolDefinition** — `run` callback lives on `ToolDefinition` in `llm-contract` (consistent with existing `LLMClient` interface that already has methods). Callbacks are **caller-provided closures** that capture application dependencies (e.g., `taskDispatcher`, `codeTaskRepo`) via closure scope.
9. **Trigger actions** — `pull_request.opened` and `pull_request.synchronize` (new PRs + new commits pushed)
10. **Self-contained pricing** — Tool calling pricing hardcoded in `infra-gemini` (like orchestrator's `VERIFIER_PRICING`), not through `pricingContext`
11. **Deduplication** — Before dispatching a review, check if a `running`/`dispatched`/`queued` review task already exists for the same PR. Skip if so. Prevents duplicate reviews from rapid `synchronize` events.
12. **Separate webhook routing path** — `pull_request.opened/synchronize` events route to the GitHub Agent use case via a new code path in the webhook handler, independent of the existing `ActionableEventRule` → `dispatchService` pipeline (which only handles comments/reviews).
13. **Review terminal status** — Review tasks use `'implemented'` as their terminal success status, same as execution and pull_request agents. No new status value needed.

## Tool Calling Infrastructure

### Package Dependency

```
code-agent
  → @intexuraos/llm-contract    (abstract types: ToolDefinition, ToolCallingClient)
  → calls createToolCallingClient(config) from @intexuraos/llm-factory (platform key)

@intexuraos/llm-contract
  → defines ToolDefinition, ToolCallingClient, ToolCallingResult, ToolCallingMessage

@intexuraos/llm-factory
  → depends on llm-contract
  → createToolCallingClient(config) routes to infra-gemini

@intexuraos/infra-gemini
  → depends on @google/genai (SDK stays HERE — already a dependency)
  → implements Gemini function calling agent loop
  → owns TOOL_CALLING_PRICING constant
```

Note: `infra-gemini` already depends on `@google/genai` and `llm-factory` already depends on `infra-gemini`. No new package.json dependency additions needed.

### Types (in `llm-contract/src/toolCalling.ts`)

```typescript
interface ToolCallingMessage {
  role: 'user' | 'assistant';  // 'tool' role not needed — Gemini uses functionResponse parts
  content: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  /**
   * Execute the tool. Called by the agent loop when the LLM invokes this tool.
   * Returns a JSON string that is sent back to the LLM as a functionResponse.
   * Callbacks are caller-provided closures that capture application dependencies.
   */
  run: (args: Record<string, unknown>) => Promise<string>;
}

interface ToolCallingClient {
  /**
   * Run the agent loop. Logger, auditSink, and usageSink are baked into the
   * client instance at factory creation time — callers do not pass them.
   */
  run(params: {
    systemPrompt: string;
    messages: ToolCallingMessage[];
    tools: ToolDefinition[];
    maxIterations?: number;  // default: 5
  }): Promise<Result<ToolCallingResult, LLMError>>;
}

interface ToolCallingResult {
  content: string;           // final LLM text response
  toolCallsMade: number;     // total across all iterations
  iterationCount: number;    // total iterations (including final text response)
  usage: NormalizedUsage;    // aggregated tokens + cost
}
```

### Model (in `llm-contract/src/supportedModels.ts`)

```typescript
// --- Narrowed subset for tool calling (uses existing Gemini25Flash type) ---
// Gemini25Flash already exists in supportedModels.ts:27 and is registered in
// LlmModels, ALL_LLM_MODELS, MODEL_PROVIDER_MAP, FastModel, ALL_FAST_MODELS,
// FAST_MODEL_DISPLAY_NAMES — no additions needed for those.
// getProviderForModel(config.model) works directly in the factory.

type ToolCallingModel = Gemini25Flash;
// ToolCallingModel ⊂ LLMModel — restricts which models can be used for agent loops.
// Every ToolCallingModel is also a valid LLMModel.
// Future: add newer Gemini models as they become available

const ALL_TOOL_CALLING_MODELS: ToolCallingModel[] = ['gemini-2.5-flash'];

function isToolCallingModel(model: string): model is ToolCallingModel {
  return ALL_TOOL_CALLING_MODELS.includes(model as ToolCallingModel);
}
```

### Pricing (self-contained in `infra-gemini/src/toolCallingClient.ts`)

```typescript
// Same pattern as VERIFIER_PRICING in completion-verifier.ts
// Bypasses code-agent's pricingContext (which throws on pricing operations)
const TOOL_CALLING_PRICING: Record<ToolCallingModel, ModelPricing> = {
  'gemini-2.5-flash': {
    inputPricePerMillion: 0.50,
    outputPricePerMillion: 2.00,
    groundingCostPerRequest: 0,
  },
};
```

### Agent Loop (in `infra-gemini/src/toolCallingClient.ts`)

`ToolCallingClient.run()` owns the loop:

1. Convert `ToolDefinition[]` → Gemini `functionDeclarations` (strip `run`, keep `name`/`description`/`parameters`)
2. Call `ai.models.generateContent({ model, systemInstruction, contents, config: { tools } })`
3. Check response `parts` for `functionCall`
4. If `functionCall` found: find matching `ToolDefinition` by name, call `toolDef.run(args)`
5. Append `functionResponse` to conversation contents
6. Loop back to step 2 (cap at `maxIterations`)
7. If no `functionCall`: break, return `ToolCallingResult`
8. Aggregate `NormalizedUsage` across all iterations
9. Log each iteration: iteration number, tool called (name + args), tool response (truncated), token usage, duration

#### Response Validation

Trust the `@google/genai` SDK types — no Zod or runtime schema validation of Gemini responses. Use null-coalescing at each access point (same pattern as existing `client.ts`): `response.candidates?.[0]?.content?.parts ?? []`. Missing/malformed data is treated as "empty response" error. Tool call `args` are validated on the consumer side (e.g., `validateReviewType()`).

#### Error Handling

| Failure Mode                               | Behavior                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hallucinated tool name                     | Send `functionResponse` with `{ error: "Unknown tool: {name}" }` back to LLM for self-correction. Count against `maxIterations`.                       |
| `run` callback throws                      | Catch error, send `functionResponse` with `{ error: "{message}" }` back to LLM. Log warning. Count against `maxIterations`.                            |
| Gemini API error mid-loop                  | Return `err({ code: mapGeminiError(e), message })` immediately. No retry (caller can retry).                                                           |
| Both `functionCall` and `text` in response | Process `functionCall` first. Text is logged but loop continues.                                                                                       |
| `maxIterations` exhausted                  | If last response had text, return it as `content`. Otherwise return `err({ code: 'API_ERROR', message: 'Tool calling loop exceeded maxIterations' })`. |
| Empty response (no text, no functionCall)  | Return `err({ code: 'API_ERROR', message: 'Empty response from model' })`.                                                                             |

### Observability

`ToolCallingClientConfig` (factory-level, not the abstract interface) includes:

```typescript
interface ToolCallingClientConfig {
  apiKey: string;
  model: ToolCallingModel;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;   // audit each LLM call
  usageSink?: UsageSink;    // track per-call token usage
}
```

Logger, auditSink, and usageSink are baked into the `ToolCallingClient` instance at factory creation time. Callers of `client.run()` do not pass them — they are internal to the implementation.

Each iteration is logged with structured fields: `{ iteration, toolName, toolArgs, toolResponseTruncated, usage, durationMs }`. Per-iteration detail available via logs/audit sink. Aggregated usage in `ToolCallingResult`.

### Gemini Response Format

When the LLM decides to call a tool:
```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{
        "functionCall": {
          "name": "request_review",
          "args": { "review_type": "frontend" }
        }
      }]
    }
  }]
}
```

When done (no more tools):
```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{
        "text": "Dispatched frontend review for PR #123. Task ID: task_xyz."
      }]
    }
  }]
}
```

### Factory (in `llm-factory/src/llmClientFactory.ts`)

```typescript
function createToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient {
  const provider = getProviderForModel(config.model);  // works because ToolCallingModel ⊂ LLMModel
  switch (provider) {
    case 'google':
      return createGeminiToolCallingClient(config);
    // Future: case 'openai': ...
  }
}
```

### Platform Gemini API Key (Direct Factory, No UserServiceClient Change)

The GitHub Agent is a **platform-level operation** triggered by webhooks, not a user-initiated action. It uses a platform-owned Gemini API key directly — no need to route through `UserServiceClient.getToolCallingClient()`.

**Why not add `getToolCallingClient()` to `UserServiceClient`:**
- `code-agent` currently never calls `getLlmClient()` or `getApiKeys()` — it only uses `resolveGitHubUsername()` from the user service client
- `createUserServiceClient()` in code-agent's `services.ts:270-281` intentionally passes a throwing `pricingContext` because code-agent doesn't do LLM operations
- Adding a method to `UserServiceClient` would require updating 6+ test mock files across code-agent for no benefit
- The platform key pattern is simpler and matches the webhook-triggered (non-user) nature of the GitHub Agent

**Flow:**
1. `INTEXURAOS_GEMINI_APP_API_KEY` env var → `ServiceConfig.geminiApiKey` → `GitHubAgentDeps.geminiApiKey`
2. GitHub Agent use case calls `createToolCallingClient()` directly from `@intexuraos/llm-factory`:
   ```typescript
   const client = createToolCallingClient({
     apiKey: deps.geminiApiKey,
     model: 'gemini-2.5-flash',
     userId,
     pricing: TOOL_CALLING_PRICING['gemini-2.5-flash'],
     logger,
   });
   ```
3. No `UserServiceClient` interface change. No mock updates needed.

**New env var required:** `INTEXURAOS_GEMINI_APP_API_KEY` must be added to:
1. `apps/code-agent/src/index.ts` `REQUIRED_ENV` array
2. `terraform/environments/dev/main.tf` (code-agent service env vars)
3. `ecosystem.config.cjs` (code-agent app config)

## GitHub Agent (code-agent)

### Webhook Routing Integration — Two Independent Paths

The webhook handler (`routes/webhooks/github.ts`) processes ALL GitHub events through a shared pipeline, then forks into two **non-overlapping** dispatch paths:

```
GitHub webhook arrives
  │
  ├─ Validate signature
  ├─ Parse event
  ├─ Save to Firestore
  ├─ Upsert PR summary
  │
  ├─── Path A (NEW): GitHub Agent ──────────────────────────────
  │    Condition: pull_request.opened OR pull_request.synchronize
  │    Action:    fire-and-forget → githubAgentUseCase.handle()
  │    Result:    LLM decides → dispatch review task (or skip)
  │
  ├─── Path B (EXISTING): Rules Pipeline ───────────────────────
  │    Condition: webhookRules.evaluate() → shouldDispatch
  │    Handles:   issue_comment.created
  │               pull_request_review.submitted
  │               issue_comment.edited (by bots)
  │    Action:    dispatchService.dispatch() → planning/execution
  │
  └─ Return 200
```

**Why they don't conflict:**
- `ActionableEventRule` returns `EVENT_NOT_ACTIONABLE` for `pull_request.opened/synchronize` → Path B does nothing
- Path A only triggers for `pull_request.opened/synchronize` → ignores comments/reviews
- Both paths run independently in the same request — Path A is fire-and-forget, Path B is evaluated synchronously
- A single webhook event can only match ONE path (event types are mutually exclusive)

**Integration point:** After event saving (line 184) and PR summary upsert (line 205), but before rules evaluation (line 218), add:

```typescript
// NEW: Route pull_request.opened/synchronize to GitHub Agent
if (
  parsedEvent.eventType === 'pull_request' &&
  (parsedEvent.action === 'opened' || parsedEvent.action === 'synchronize')
) {
  const { githubAgentUseCase } = getServices();
  // Fire-and-forget — agent runs async, webhook returns 200 immediately
  // .catch() ensures errors are logged, not silently swallowed
  githubAgentUseCase.handle({
    event: savedEvent,
    webhookBody: request.body,
    logger,
  }).catch((error: unknown) => {
    logger.error({ error, eventId: savedEvent.id }, 'GitHub Agent: unhandled error in async handler');
  });
}

// Existing rules evaluation continues below (no conflict — ActionableEventRule
// filters out pull_request events, so dispatchService won't fire for these)
```

**`GitHubWebhookBody` extension:** The existing type (line 41-48) needs `base` and `head` refs for the GitHub Agent:

```typescript
pull_request?: {
  id: number;
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  merged_at?: string | null;
  base?: { ref: string; sha: string };  // NEW — base branch + SHA
  head?: { ref: string; sha: string };  // NEW — head branch + SHA
};
```

### User Resolution

The `userId` is resolved from the webhook's `sender.login` field using the existing `UserLookupService` (same mechanism used by `createTaskForPR`). The `resolveLoginForTaskCreation()` function in `gitHubDispatchService.ts` handles bot senders by extracting the repo owner. If no user is found, the GitHub Agent use case returns early with an error (no comment posted, no review dispatched).

### Deduplication

Before dispatching a review, the use case queries `codeTaskRepo` for existing tasks matching:
- Same `repository` + `prNumber`
- `agentType: 'review'`
- `status` in `['running', 'dispatched', 'queued']`

If a matching task exists, the GitHub Agent's `request_review` tool callback returns `{ status: 'already_running', taskId }` to the LLM. The LLM explains this in its comment. This prevents duplicate reviews from rapid `synchronize` events (multiple commits pushed in quick succession).

Note: Since `agentType` is optional on `CodeTask` (older tasks have `agentType: undefined`), the Firestore query for `agentType === 'review'` naturally excludes older non-review tasks.

**Firestore composite index required** — `findActiveReviewForPR()` queries on `repository` + `prNumber` + `agentType` + `status`. Add to `firestore.indexes.json`:

```json
{
  "collectionGroup": "code_tasks",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "repository", "order": "ASCENDING" },
    { "fieldPath": "prNumber", "order": "ASCENDING" },
    { "fieldPath": "agentType", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

Also add a migration file (`apps/code-agent/src/infra/migrations/NNN-review-composite-index.mjs`) documenting the index requirement, following existing migration patterns.

### Diff Context

The GitHub Agent runs in code-agent (not a Docker worker), so it cannot use `gh` CLI. All context must be pre-fetched via GitHub REST API.

```typescript
interface DiffContext {
  files: Array<{
    filename: string;
    status: 'added' | 'modified' | 'removed' | 'renamed';
    additions: number;
    deletions: number;
    patch?: string;  // included only if total diff ≤ 100KB
  }>;
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
  commitMessages: string[]; // from GET /pulls/{n}/commits → commit.message
  truncated: boolean;       // true if patches were omitted due to size
  baseSha: string;          // from webhook payload pull_request.base.sha
  headSha: string;          // from webhook payload pull_request.head.sha
}
```

**Threshold:** If total patch size ≤ 100KB, include all patches. If > 100KB, omit patches and send only filenames + stats.

**Pagination:** The GitHub `/pulls/{n}/files` endpoint returns at most 300 files per page. For PRs with >300 files, paginate until all files are collected. In practice, >300-file PRs are rare and would likely exceed the 100KB patch threshold anyway.

**Full context passed to the LLM:**

| Context                              | Source                                                     | Purpose                               |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------- |
| Changed file paths + stats + patches | `GET /repos/{owner}/{repo}/pulls/{number}/files`           | Know which apps/packages are affected |
| PR title + body                      | Webhook payload (already available)                        | Understand intent                     |
| Commit messages                      | `GET /repos/{owner}/{repo}/pulls/{number}/commits`         | Understand incremental changes        |
| Base + head SHAs                     | Webhook payload `pull_request.base.sha`, `.head.sha`       | Precise commit identification         |

**Note on Linear context:** The GitHub Agent does NOT fetch Linear issue details or planning task plans. Its job is a fast routing decision (which files changed → dispatch review or not). Linear/planning context is not needed for this decision and adds latency + complexity. The **Review Agent** (Layer 2) fetches richer context inside the Docker container if needed — it can extract `[INT-XXX]` from the PR title and query Linear via CLI. PRs may not have an associated Linear issue at all (e.g., bot PRs, direct fixes).

**New methods on `GitHubPRClient` interface** (`domain/ports/gitHubPRClient.ts`):

```typescript
export interface GitHubPRClient {
  updatePRTitle(token: string, owner: string, repo: string, prNumber: number, newTitle: string): Promise<Result<void, GitHubPRClientError>>;

  // NEW — GitHub Agent methods (use GitHub App token, not per-user OAuth)
  getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<Result<PRFileInfo[], GitHubPRClientError>>;
  getPullRequestCommits(owner: string, repo: string, prNumber: number): Promise<Result<PRCommitInfo[], GitHubPRClientError>>;
  postPRComment(owner: string, repo: string, prNumber: number, body: string): Promise<Result<{ commentId: number }, GitHubPRClientError>>;
}
```

**Token strategy:** All methods use per-user OAuth tokens resolved at call time. The GitHub Agent resolves `senderLogin` → `userId` via `userServiceClient.resolveGitHubUsername()`, then fetches the user's GitHub OAuth token via `userServiceClient.getOAuthToken(userId, 'github')`. This ensures the agent only evaluates PRs from users who have connected their GitHub account to IntexuraOS.

**How the token reaches the implementation:** Each `GitHubPRClient` method accepts a `token: string` as its first parameter, used for `Authorization: Bearer` header. The caller (use case) is responsible for resolving the per-user token via `UserServiceClient`.

**Wiring in `services.ts`:**
```typescript
const gitHubPRClient = createGitHubPRHttpClient({
  timeoutMs: 10000,
});
```

Implementations go in `infra/http/gitHubPRHttpClient.ts`:
- `getPullRequestFiles` → `GET /repos/{owner}/{repo}/pulls/{number}/files` (paginated, max 300/page)
- `getPullRequestCommits` → `GET /repos/{owner}/{repo}/pulls/{number}/commits`
- `postPRComment` → `POST /repos/{owner}/{repo}/issues/{number}/comments` (uses issues API for PR comments)

### GitHub Agent Use Case

```typescript
// apps/code-agent/src/domain/usecases/githubAgent.ts

export interface GitHubAgentDeps {
  userLookupService: UserLookupService;
  codeTaskRepo: CodeTaskRepository;
  workerSettingsRepo: WorkerSettingsRepository;
  taskDispatcher: TaskDispatcherService;
  gitHubPRClient: GitHubPRClient;
  linearAgentClient: LinearAgentClient;
  allowedBots: Set<string>;        // from ServiceConfig, same as gitHubDispatchService
  geminiApiKey: string;            // INTEXURAOS_GEMINI_APP_API_KEY (platform key)
  orchestratorSecret: string;      // from ServiceConfig, same as createTaskForPR
  serviceUrl: string;              // from ServiceConfig, same as createTaskForPR
}

// --- Factory function ---

export interface GitHubAgentUseCase {
  handle(params: GitHubAgentHandleParams): Promise<void>;
}

export function createGitHubAgentUseCase(deps: GitHubAgentDeps): GitHubAgentUseCase {
  // ... closure captures deps, returns { handle }
  return { handle };
  // handle and dispatchReviewTask defined below as closures over deps
}

export interface GitHubAgentHandleParams {
  event: GitHubPREvent;
  webhookBody: GitHubWebhookBody;
  logger: Logger;
}

// --- Helper: parse owner/repo from "owner/repo" string ---

function parseOwnerRepo(repository: string): { owner: string; repo: string } | null {
  const parts = repository.split('/');
  const owner = parts[0];
  const repo = parts[1];
  if (owner === undefined || repo === undefined) return null;
  return { owner, repo };
}

// --- Helper: build user message for LLM ---

function buildEventMessage(
  event: GitHubPREvent,
  webhookBody: GitHubWebhookBody,
  diff: DiffContext,
): string {
  const pr = webhookBody.pull_request;
  const lines: string[] = [
    '## GitHub Event\n',
    `Type: pull_request`,
    `Action: ${event.action}`,
    `PR #${String(event.pullRequestNumber)}: ${pr?.title ?? '(no title)'}`,
    `Repository: ${event.repository}`,
    `Base branch: ${pr?.base?.ref ?? 'unknown'}`,
    `Sender: ${event.senderLogin}`,
    `Base SHA: ${diff.baseSha}`,
    `Head SHA: ${diff.headSha}`,
  ];

  if (pr?.body !== undefined && pr.body !== null) {
    lines.push(`\n## PR Description\n\n${pr.body}`);
  }

  lines.push(`\n## Changed Files (${String(diff.totalFiles)} files, +${String(diff.totalAdditions)} additions, -${String(diff.totalDeletions)} deletions)\n`);
  lines.push('| File | Status | +/- |');
  lines.push('| --- | --- | --- |');
  for (const f of diff.files) {
    lines.push(`| ${f.filename} | ${f.status} | +${String(f.additions)}/-${String(f.deletions)} |`);
  }

  if (diff.commitMessages.length > 0) {
    lines.push(`\n## Commits (${String(diff.commitMessages.length)})\n`);
    for (const msg of diff.commitMessages) {
      lines.push(`- ${msg.split('\n')[0] ?? msg}`);  // first line only
    }
  }

  if (!diff.truncated) {
    lines.push('\n## Patches\n');
    for (const f of diff.files) {
      if (f.patch !== undefined) {
        lines.push(`### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``);
      }
    }
  } else {
    lines.push('\n*Patches omitted — total diff exceeds 100KB.*');
  }

  return lines.join('\n');
}

// --- Helper: validate review_type arg ---

const VALID_REVIEW_TYPES = new Set(['frontend']);

function validateReviewType(args: Record<string, unknown>): string | null {
  const reviewType = args['review_type'];
  if (typeof reviewType !== 'string' || !VALID_REVIEW_TYPES.has(reviewType)) {
    return null;
  }
  return reviewType;
}

// --- Main handler ---

async function handle(params: GitHubAgentHandleParams): Promise<void> {
  const { event, webhookBody, logger } = params;

  // 1. Parse owner/repo (strict — no non-null assertions)
  const parsed = parseOwnerRepo(event.repository);
  if (parsed === null) {
    logger.error({ repository: event.repository }, 'GitHub Agent: invalid repository format');
    return;
  }
  const { owner, repo } = parsed;

  // 2. Resolve userId from sender (with bot fallback)
  // Bot senders (e.g., intexuraos-bot) won't have user accounts.
  // resolveLoginForTaskCreation maps bot logins to the repo owner (same pattern as gitHubDispatchService.ts:130).
  const effectiveLogin = resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots);
  const userResult = await deps.userLookupService.resolveByGitHubUsername(effectiveLogin);
  if (!userResult.ok) {
    logger.warn({ sender: event.senderLogin, effectiveLogin }, 'GitHub Agent: user not found, skipping');
    return;
  }
  const { userId, worker } = userResult.value;

  // 3. Fetch diff context via GitHub API
  const prNumber = event.pullRequestNumber;
  const diff = await fetchDiffContext(owner, repo, prNumber, webhookBody);

  // 4. Create tool calling client (platform key — no UserServiceClient needed)
  const client = createToolCallingClient({
    apiKey: deps.geminiApiKey,
    model: 'gemini-2.5-flash',
    userId,
    pricing: TOOL_CALLING_PRICING['gemini-2.5-flash'],
    logger,
  });

  // 5. Build user message for agent
  const message = buildEventMessage(event, webhookBody, diff);

  // 6. Run agent with tools
  const result = await client.run({
    systemPrompt: githubAgentPrompt.build({ event }),
    messages: [{ role: 'user', content: message }],
    tools: [
      {
        name: 'request_review',
        description: 'Dispatch a code review for a pull request',
        parameters: {
          type: 'object',
          properties: {
            review_type: { type: 'string', enum: ['frontend'] },
          },
          required: ['review_type'],
        },
        run: async (args) => {
          // Validate review_type (no unsafe cast)
          const reviewType = validateReviewType(args);
          if (reviewType === null) {
            return JSON.stringify({ status: 'failed', reason: 'invalid_review_type' });
          }

          const dispatchResult = await dispatchReviewTask({
            userId,
            worker,
            repository: event.repository,
            baseBranch: webhookBody.pull_request?.base?.ref ?? 'main',
            prNumber,
            prTitle: webhookBody.pull_request?.title ?? '',
            reviewType,
            eventId: String(event.githubEventId),
            logger,
          });
          if (!dispatchResult.ok) {
            return JSON.stringify({ status: 'failed', reason: dispatchResult.error.code });
          }
          const { taskId: tid, alreadyRunning } = dispatchResult.value;
          const status = alreadyRunning ? 'already_running' : 'dispatched';
          return JSON.stringify({ status, taskId: tid });
        },
      },
    ],
    maxIterations: 3,
  });

  // 7. Post GH comment about decision (ALWAYS — even when no tools invoked)
  if (result.ok) {
    await deps.gitHubPRClient.postPRComment(
      owner, repo, prNumber,
      `🔍 **GitHub Agent**\n\n${result.value.content}`
    );
  } else {
    logger.error({ error: result.error }, 'GitHub Agent: tool calling failed');
  }
}
```

### Review Task Dispatch

The `request_review` tool callback creates a `CodeTask` in Firestore and dispatches it to the orchestrator, following the same pattern as `createTaskForPR` (lines 253-384).

```typescript
// Inside githubAgent.ts

async function dispatchReviewTask(params: {
  userId: string;
  worker: { name: string; url: string; cfAccessClientId: string; cfAccessClientSecret: string; dispatchSigningSecret: string };
  repository: string;
  baseBranch: string;
  prNumber: number;
  prTitle: string;
  reviewType: string;
  eventId: string;
  logger: Logger;
}): Promise<Result<{ taskId: string; alreadyRunning: boolean }, DispatchError>> {
  // 1. Dedup check: skip if review already in progress for this PR
  const existing = await deps.codeTaskRepo.findActiveReviewForPR({
    repository: params.repository,
    prNumber: params.prNumber,
  });
  if (existing !== null) {
    return ok({ taskId: existing.id, alreadyRunning: true });
  }

  // 2. Create CodeTask in Firestore
  const taskId = `task_${crypto.randomUUID()}`;
  // Reuse existing utility from domain/utils/secrets.ts
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, taskId);
  const prompt = `Review PR #${String(params.prNumber)} in ${params.repository}. ` +
    `Review type: ${params.reviewType}. PR title: ${params.prTitle}`;

  const createResult = await deps.codeTaskRepo.create({
    id: taskId,
    userId: params.userId,
    prompt,
    sanitizedPrompt: prompt.slice(0, 1000),
    systemPromptHash: 'review-v1',
    workerType: 'auto',
    workerLocation: params.worker.name,    // from resolved worker (same as createTaskForPR line 263)
    repository: params.repository,
    baseBranch: params.baseBranch,
    traceId: `review-pr${String(params.prNumber)}-${params.eventId}`,  // unique trace ID
    agentType: 'review',
    prNumber: params.prNumber,
    webhookSecret,
  });

  if (!createResult.ok) {
    params.logger.error({ taskId, error: createResult.error }, 'Failed to create review task');
    return err({ code: 'dispatch_failed', message: createResult.error.message });
  }

  // 3. Build worker credentials (same pattern as createTaskForPR lines 360-368)
  const workerCredentials: DispatchWorkerCredentials = {
    workers: [{
      name: params.worker.name,
      url: params.worker.url,
      cfAccessClientId: params.worker.cfAccessClientId,
      cfAccessClientSecret: params.worker.cfAccessClientSecret,
      dispatchSigningSecret: params.worker.dispatchSigningSecret,
    }],
  };

  // 4. Dispatch to orchestrator
  const dispatchResult = await deps.taskDispatcher.dispatch({
    taskId,
    linearIssueLabels: [],
    hasChildren: false,
    prompt,
    systemPromptHash: 'review-v1',
    repository: params.repository,
    baseBranch: params.baseBranch,
    workerType: 'auto',
    webhookUrl: `${deps.serviceUrl}/internal/webhooks/task-complete`,
    webhookSecret,
    workerCredentials,
    agentType: 'review',
  });

  // 5. Handle dispatch result
  if (!dispatchResult.ok) {
    params.logger.error({ taskId, error: dispatchResult.error }, 'Failed to dispatch review task');
    await deps.codeTaskRepo.update(taskId, {
      status: 'failed',
      error: { code: dispatchResult.error.code, message: dispatchResult.error.message },
    });
    return err(dispatchResult.error);
  }

  // 6. Update task with actual worker location (same as createTaskForPR line 452-454)
  await deps.codeTaskRepo.update(taskId, {
    workerLocation: dispatchResult.value.workerLocation,
  });

  return ok({ taskId, alreadyRunning: false });
}
```

**Key mapping for review dispatch fields:**

| DispatchRequest field | Value for review tasks                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `taskId`              | `task_${randomUUID()}`                                                                      |
| `linearIssueLabels`   | `[]` (no Linear labels)                                                                     |
| `hasChildren`         | `false`                                                                                     |
| `prompt`              | `"Review PR #N in repo. Review type: frontend. PR title: ..."`                              |
| `systemPromptHash`    | `'review-v1'`                                                                               |
| `repository`          | From PR webhook payload                                                                     |
| `baseBranch`          | From PR webhook payload (`pull_request.base.ref`)                                           |
| `workerType`          | `'auto'` (Claude CLI with auto model selection)                                             |
| `webhookUrl`          | `${serviceUrl}/internal/webhooks/task-complete`                                             |
| `webhookSecret`       | `generateWebhookSecret(orchestratorSecret, taskId)` — reused from `domain/utils/secrets.ts` |
| `workerCredentials`   | From `userLookupService.resolveByGitHubUsername()` (resolved worker)                        |
| `agentType`           | `'review'`                                                                                  |
| `workerLocation`      | `worker.name` from resolved user                                                            |
| `traceId`             | `review-pr${prNumber}-${eventId}` — unique per event                                        |

### GitHub Agent Prompt

New `PromptBuilder` in `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`:
- `name: 'github-agent'`
- `description: 'GitHub Agent system prompt for PR event analysis and review dispatch'`
- `version: '1.0.0'`

See **Prompts** section below for the full prompt template and sample.

### ServiceContainer Wiring (C3 — fully specified)

**1. ServiceConfig extension:**

```typescript
// apps/code-agent/src/services.ts — add to ServiceConfig interface
export interface ServiceConfig {
  // ... existing fields ...
  geminiApiKey: string;      // INTEXURAOS_GEMINI_APP_API_KEY
  // Note: githubBotToken removed — per-user OAuth tokens used instead
}
```

**2. ServiceContainer extension:**

```typescript
// Add to ServiceContainer interface
export interface ServiceContainer {
  // ... existing fields ...
  githubAgentUseCase: GitHubAgentUseCase;
}
```

**3. Import + wiring in `initServices()`:**

```typescript
// New imports at top of services.ts
import { createGitHubAgentUseCase, type GitHubAgentUseCase } from './domain/usecases/githubAgent.js';

// Inside initServices(), after dispatchService creation (line ~367):
const githubAgentUseCase = createGitHubAgentUseCase({
  userLookupService,
  codeTaskRepo,
  workerSettingsRepo,
  taskDispatcher,
  gitHubPRClient,
  linearAgentClient,
  allowedBots: ALLOWED_BOTS,  // reuse imported constant (same as ActionableEventRule, line 344)
  geminiApiKey: config.geminiApiKey,
  orchestratorSecret: config.orchestratorSecret,
  serviceUrl: config.serviceUrl,
});

// Add to container object:
container = {
  // ... existing fields ...
  githubAgentUseCase,
};
```

**4. Config loader (`config.ts`) — add fields to `Config` and `loadConfig()`:**

```typescript
// apps/code-agent/src/config.ts — add to Config interface (line 12)
export interface Config {
  // ... existing fields ...
  geminiApiKey: string;      // INTEXURAOS_GEMINI_APP_API_KEY
}

// Add to loadConfig() (line 35) — reads from env vars:
const geminiApiKey = process.env['INTEXURAOS_GEMINI_APP_API_KEY'] ?? '';
// Add to return object:
return { ...existing, geminiApiKey };
```

**5. Env var validation in `index.ts`:**

```typescript
// apps/code-agent/src/index.ts — add to REQUIRED_ENV
const REQUIRED_ENV = [
  // ... existing ...
  'INTEXURAOS_GEMINI_APP_API_KEY',
] as const;

// index.ts already passes config.* to initServices() — new Config fields
// flow automatically: loadConfig() → config.geminiApiKey → initServices({ geminiApiKey: config.geminiApiKey })
// Note: INTEXURAOS_GITHUB_BOT_TOKEN was removed — per-user OAuth tokens are used instead.
```

**5. Mock in tests:**

```typescript
// apps/code-agent/src/__tests__/helpers/mockServices.ts — add to mock container
githubAgentUseCase: {
  handle: vi.fn().mockResolvedValue(undefined),
},
```

### Worker Type for Review Tasks (I8)

Review tasks use `workerType: 'auto'`, same as `createTaskForPR` (line 262). The orchestrator resolves the actual model based on available worker API keys and routing rules. For review tasks, the orchestrator will use Claude CLI with automatic model selection. `'auto'` is the correct choice because:
- Review tasks run the same Docker container type as planning/execution
- Model selection is an orchestrator concern, not code-agent's
- No review-specific model requirement for MVP

## Orchestrator — Review Agent

### System Prompt

New `reviewPrompt: PromptBuilder<SystemPromptParams>` in `system-prompt.ts` for `agentType === 'review'` (same params type as all other prompts):
- `name: 'orchestrator-review'`
- `description: 'Review agent system prompt for automated PR review with subagents'`
- `version: '1.0.0'`

Routing in `buildSystemPrompt()`: new branch at line 468: `if (resolvedAgentType === 'review') return reviewPrompt.build(params)` (before the existing planning/execution branches).

**PR context delivery:** The review agent's task `prompt` field contains the PR number, repository, and review type. The review prompt instructs the agent to fetch full PR context via `gh` CLI:
- `gh pr view {prNumber} --json title,body,baseRefName,files`
- `gh pr diff {prNumber}`
- `gh api /repos/{repo}/pulls/{prNumber}/reviews`

This follows the same pattern as the existing `pull_request` agent type, where PR context is fetched by the agent itself using `gh` CLI inside the Docker container.

**Review type → dimension mapping:** The review prompt contains a mapping table:
- `frontend` → all 6 dimensions (React Patterns, TypeScript, Tailwind, UX, Conventions, Tests)
- Future review types will map to subsets

Contains:
- Review-only mandate (never commit, never push)
- Subagent definitions for 6 review dimensions
- Confidence scoring (0-100, threshold ≥80)
- POST-then-PATCH comment pattern per subagent
- `REVIEW_AGENT_FINAL` output block format

See **Prompts** section below for the full prompt template.

### GitHub Auth for Review Agent

Review Agent runs in the same Docker container type as planning/execution agents. Auth is already solved:
- `token-refresher.ts:116` writes a refreshed GitHub token to `/secrets/github-token` inside the container
- `Dockerfile:36` installs a `gh` CLI wrapper script that reads this token file for authentication
- `entrypoint.sh:26` configures a git credential helper using `/secrets/github-token` for HTTPS auth
- `start.ts:464` triggers the initial token refresh before the container starts
- Subagents spawned via Claude's built-in `Agent` tool run WITHIN the same container and inherit `gh` CLI auth

No additional auth setup needed. The existing token refresh + credential helper flow covers all `gh api` calls the review subagents need (POST/PATCH PR comments).

### Review Dimensions (6 subagents)

| #   | Dimension              | Focus                                                                          |
| --- | ---------------------- | ------------------------------------------------------------------------------ |
| 1   | React Patterns         | Component structure, hooks, SRP ~150 lines, memoization, state management      |
| 2   | TypeScript Strict Mode | noUncheckedIndexedAccess, exactOptionalPropertyTypes, strictBooleanExpressions |
| 3   | TailwindCSS & Visual   | Class consistency, responsive, dark mode, UI primitives, Lucide icons          |
| 4   | UX Heuristics          | Loading/error/empty states, user feedback, navigation, accessibility           |
| 5   | Project Conventions    | CLAUDE.md compliance, hash routing, API three-layer, env vars, Auth0           |
| 6   | Test Quality           | Coverage for utils/services/hooks, test isolation, cleanup, Vitest patterns    |

### Completion Verifier Schema

```typescript
// Zod schema (consistent with existing PLANNING_SCHEMA, EXECUTION_SCHEMA, PULL_REQUEST_SCHEMA)
export const REVIEW_SCHEMA = z.object({
  findings_count: z.string(),
  critical_count: z.string(),
  important_count: z.string(),
  suggestion_count: z.string(),
  dimensions_reviewed: z.string(),  // comma-separated
  verdict: z.enum(['approve', 'request_changes', 'comment']),
  summary: z.string(),
});

export interface ReviewAgentData {
  agentType: 'review';
  findings_count: string;
  critical_count: string;
  important_count: string;
  suggestion_count: string;
  dimensions_reviewed: string;
  verdict: 'approve' | 'request_changes' | 'comment';
  summary: string;
}
```

### `CompletionVerifierVerdict.agentData` Extension

The `agentData` union on `CompletionVerifierVerdict` (line 30) must be extended:

```typescript
// Before:
agentData?: PlanningAgentData | ExecutionAgentData | PullRequestAgentData;

// After:
agentData?: PlanningAgentData | ExecutionAgentData | PullRequestAgentData | ReviewAgentData;
```

### Review `TaskResult` Fields

Both `TaskResult` types (orchestrator `types/task.ts` line 73 and code-agent `domain/models/codeTask.ts` line 63) must be extended with review-specific fields:

```typescript
// Add to TaskResult interface
review_findings_count?: string;
review_critical_count?: string;
review_important_count?: string;
review_suggestion_count?: string;
review_dimensions_reviewed?: string;
review_verdict?: 'approve' | 'request_changes' | 'comment';
```

### `buildResultFromVerification` Review Branch

In `task-dispatcher.ts` (line 1052), the `buildResultFromVerification` method needs a dedicated `'review'` branch. Currently the `else` branch handles `pull_request` data (`gh_pr_url`, `comments_replied`) which doesn't match review fields:

```typescript
// Add before the else branch (line 1086):
} else if (agentData.agentType === 'review') {
  // Type-safe: TypeScript narrows agentData to ReviewAgentData after this check
  const reviewData: ReviewAgentData = agentData;
  base.review_findings_count = reviewData.findings_count;
  base.review_critical_count = reviewData.critical_count;
  base.review_important_count = reviewData.important_count;
  base.review_suggestion_count = reviewData.suggestion_count;
  base.review_dimensions_reviewed = reviewData.dimensions_reviewed;
  base.review_verdict = reviewData.verdict;
} else {
  // existing pull_request branch
```

Note: The `agentData.agentType === 'review'` check provides TypeScript discriminated union narrowing — no cast needed. The intermediate `reviewData` variable is optional (for readability) since TypeScript already narrows `agentData` to `ReviewAgentData` inside the branch.

### Terminal Status

Review tasks use `'implemented'` as their terminal success status, same as execution and pull_request agents. This is set in `finalizeTaskWithResult` which calls `finalizeTask(task, 'implemented', ...)` for all non-planning agent types. No new status value needed.

### Concurrent Review Dispatch

Review tasks share the orchestrator's existing capacity pool (mutex-guarded `runningCount` vs `config.capacity`). When at capacity:
1. `taskDispatcher.dispatch()` returns `at_capacity` error
2. GitHub Agent's `request_review` tool `run` callback returns `{ status: 'failed', reason: 'at_capacity' }` to LLM
3. LLM explains in final text that review couldn't be dispatched
4. Code-agent posts this explanation as GH comment
5. User can re-trigger by pushing a new commit

No priority queue for MVP. First-come-first-served.

## `agentType: 'review'` — Full Type Cascade

Adding `'review'` to the `agentType` union requires changes across 14 source files + tests. Listed in dependency order:

### Tier 1: Type Definitions

| File                                                       | Line   | Change                                  |
| ---------------------------------------------------------- | ------ | --------------------------------------- |
| `apps/code-agent/src/domain/models/codeTask.ts`            | 22     | Add `'review'` to `AgentType` union     |
| `workers/orchestrator/src/services/completion-verifier.ts` | 9      | Add `'review'` to `CompletionAgentType` |

### Tier 2: Domain Interfaces (code-agent)

| File                                                            | Line   | Change                                                                           |
| --------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/services/taskDispatcher.ts`         | 48     | Add `'review'` to `DispatchRequest.agentType`                                    |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` | 38     | Add `'review'` to `CreateTaskInput.agentType` + `findActiveReviewForPR()` method |

### Tier 3: Orchestrator Types

| File                                        | Line   | Change                                          |
| ------------------------------------------- | ------ | ----------------------------------------------- |
| `workers/orchestrator/src/types/task.ts`    | 44     | Add `'review'` to `Task.agentType`              |
| `workers/orchestrator/src/types/task.ts`    | 73     | Add `review_*` fields to `TaskResult`           |
| `workers/orchestrator/src/types/api.ts`     | 25     | Add `'review'` to `CreateTaskRequest.agentType` |
| `workers/orchestrator/src/types/schemas.ts` | 47     | Add `'review'` to `z.enum([...])`               |

### Tier 4: Implementation Routing

| File                                                       | Line      | Change                                                                                                                                            |
| ---------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/system-prompt.ts`       | 12, 460   | Add `'review'` to `SystemPromptParams.agentType` union (line 12: `'planning' \                                                                    | 'execution' \ | 'pull_request' \ | 'review'`) + `reviewPrompt: PromptBuilder<SystemPromptParams>` + `'review'` branch in `buildSystemPrompt()` routing |
| `workers/orchestrator/src/services/completion-verifier.ts` | 25-59     | Add `ReviewAgentData` to `CompletionVerifierVerdict.agentData` union + `REVIEW_SCHEMA` (Zod) + routing in `selectSchemaAndPrompt` + `toAgentData` |
| `workers/orchestrator/src/services/task-dispatcher.ts`     | 1052-1094 | Add `agentType === 'review'` branch in `buildResultFromVerification` (before `else` at line 1086)                                                 |

### Tier 5: Infrastructure & Web

| File                                                       | Line   | Change                                               |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------- |
| `apps/code-agent/src/domain/models/codeTask.ts`            | 63     | Add `review_*` fields to `TaskResult`                |
| `apps/code-agent/src/infra/services/taskDispatcherImpl.ts` | 62     | Add `'review'` to `CreateTaskRequestInput.agentType` |
| `apps/code-agent/src/routes/codeRoutes.ts`                 | 109    | Add `'review'` to Fastify response schema enum       |
| `apps/web/src/types/index.ts`                              | 1187   | Add `'review'` to `CodeTask.agentType`               |
| `docs/services/orchestrator/agent.md`                      | 34     | Update documentation                                 |

### Tier 6: Tests

All test files that mock or reference `agentType` or build `ServiceContainer` must be updated. Key locations:
- `apps/code-agent/src/__tests__/helpers/mockServices.ts` (add `githubAgentUseCase` mock to `ServiceContainer` — line 121)
- `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts` (builds `ServiceContainer` directly — line 112)
- `apps/code-agent/src/__tests__/openapi-contract.test.ts` (builds `ServiceContainer` via `setServices` — line 93)
- `apps/code-agent/src/__tests__/server.test.ts` (builds `ServiceContainer` via `setServices` — line 95)
- `apps/code-agent/src/__tests__/infra/services/taskDispatcher.test.ts`
- `workers/orchestrator/src/__tests__/routes.test.ts`
- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`
- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

## Endpoint Changes

**Modified:**
- `POST /webhooks/github` (code-agent) — adds separate code path for `pull_request.opened` and `pull_request.synchronize` → GitHub Agent use case (does not modify existing rules pipeline)
- `POST /tasks` (orchestrator) — accepts `agentType: 'review'` in `CreateTaskRequest` and Zod schema
- `POST /internal/webhooks/task-complete` (code-agent) — add `review_*` fields to `TaskCompleteWebhookBody.result` type in `webhookRoutes.ts:40`. The Fastify JSON Schema at line 79 does not use `additionalProperties: false`, so new fields pass through at runtime without schema changes, but the TypeScript type should be updated for type safety.

**Unchanged:**
- All other code-agent routes (`/api/*`, other `/internal/*` endpoints)
- All other orchestrator routes (`GET /health`, `GET /tasks/:id`, `DELETE /tasks/:id`)

## End-to-End Flow

| Time     | Component    | Action                                                                 |
| -------- | ------------ | ---------------------------------------------------------------------- |
| t+0ms    | GitHub       | Sends `pull_request` webhook to code-agent (opened or synchronize)     |
| t+50ms   | code-agent   | Webhook handler validates, parses event, saves to Firestore            |
| t+60ms   | code-agent   | New code path: detects `pull_request.opened/synchronize`               |
| t+70ms   | code-agent   | Resolves `sender.login` → `userId` + worker via `UserLookupService`    |
| t+100ms  | code-agent   | Fetches PR files + commits via GitHub API, builds DiffContext          |
| t+200ms  | code-agent   | GitHub Agent use case calls `createToolCallingClient()` (platform key) |
| t+500ms  | infra-gemini | `client.run()` sends event+diff+context to Gemini with tools           |
| t+2s     | Gemini API   | Returns `functionCall: request_review({ review_type: 'frontend' })`    |
| t+2.1s   | code-agent   | Dedup check: no active review for this PR                              |
| t+2.2s   | code-agent   | Creates CodeTask in Firestore + dispatches to orchestrator             |
| t+2.5s   | infra-gemini | Sends `functionResponse` back, Gemini returns final text, loop ends    |
| t+3s     | code-agent   | Posts GH comment: agent decision + reasoning                           |
| t+5s     | orchestrator | Receives task, spawns Docker container with review agent prompt        |
| t+10s    | Review Agent | Fetches PR diff via `gh pr diff`, spawns subagents via Agent tool      |
| t+12s    | Subagents    | Each POSTs "reviewing..." comment on PR                                |
| t+2-5min | Subagents    | Each PATCHes comment with structured findings                          |
| t+5-8min | orchestrator | Sends completion webhook to code-agent                                 |

## Prompts (Samples — PR #1058)

All prompts below are shown as they would render for **PR #1058** (`[INT-742] Redesign code tasks list with issue-centric grouped view`).

### GitHub Agent System Prompt

```
You are the IntexuraOS GitHub Agent. You analyze GitHub pull request events and decide
whether to dispatch automated code reviews.

## Your Role

You receive a GitHub pull request event along with context about the changes (diff,
commits, PR description). Based on this context, you decide which review tools to invoke
using function calling.

## Available Tools

- request_review(review_type): Dispatch a code review for the pull request.
  Currently supported review types:
  - "frontend" — full frontend review (React, TypeScript, Tailwind, UX, conventions, tests)

## Decision Criteria

Dispatch a "frontend" review when:
- The PR modifies files under apps/web/
- The changes include React components, hooks, utilities, or tests
- There are meaningful code changes (not just docs or config)

Do NOT dispatch reviews for:
- Documentation-only changes (only docs/ or *.md files changed)
- Terraform/infrastructure changes (only terraform/ changed)
- Backend-only changes (only apps/code-agent/, apps/user-service/, workers/ changed)
- Package dependency bumps with no web app changes

## Output Rules

1. If you dispatch a review, briefly explain what triggered it (affected files/areas)
2. If you do NOT dispatch a review, explain why (e.g., "No frontend review needed —
   changes limited to apps/code-agent/")
3. Be concise — 2-3 sentences maximum
4. Always explain your reasoning in your final text response
```

### GitHub Agent User Message (PR #1058)

```
## GitHub Event

Type: pull_request
Action: opened
PR #1058: [INT-742] Redesign code tasks list with issue-centric grouped view
Repository: pbuchman/intexuraos-4
Base branch: development
Sender: pbuchman
Base SHA: abc1234
Head SHA: 3b50bf6

## PR Description

Group code tasks by linearIssueId with visual pipeline (Planning → Execution → PR)
replacing flat card list. Add groupByLinearIssue utility with 21 unit tests covering
grouping, pipeline derivation, aggregate status, sorting, and edge cases. Implement
merge-based refresh in useCodeTasks for stable React references, increase page size
20 → 50. Extract IssueGroupRow (memo'd with structural comparator) and IssueTimeline
to separate SRP component files. Add StatusPipeline filter bar with localStorage
persistence and archived filter → API integration.

Fixes INT-742

## Changed Files (11 files, +2277 additions, -381 deletions)

| File                                                     | Status   | +/-       |
| -------------------------------------------------------- | -------- | --------- |
| apps/web/src/__tests__/CodeTasksPage.test.tsx            | modified | +19/-9    |
| apps/web/src/components/code-tasks/IssueGroupRow.tsx     | added    | +436/-0   |
| apps/web/src/components/code-tasks/IssueTimeline.tsx     | added    | +231/-0   |
| apps/web/src/components/ui/__tests__/Input.test.tsx      | modified | +5/-2     |
| apps/web/src/hooks/__tests__/useCodeTasks.test.ts        | modified | +4/-4     |
| apps/web/src/hooks/useCodeTasks.ts                       | modified | +26/-3    |
| apps/web/src/pages/CodeTasksPage.tsx                     | modified | +254/-363 |
| apps/web/src/utils/__tests__/issueGroups.test.ts         | added    | +289/-0   |
| apps/web/src/utils/issueGroups.ts                        | added    | +203/-0   |
| docs/plans/2026-03-07-code-tasks-list-redesign-design.md | added    | +196/-0   |
| docs/plans/2026-03-07-code-tasks-list-redesign.md        | added    | +614/-0   |

## Commits (6)

1. docs: add design for code tasks list redesign (issue-centric grouped view)
2. docs: add implementation plan for code tasks list redesign
3. docs: apply code review fixes to redesign design doc and implementation plan
4. feat(web): redesign code tasks list with issue-centric grouped view [INT-742]
5. fix(web): correct test type mismatch for useCodeTasks status filter
6. fix(web): address code review feedback for code tasks redesign

```

### Expected Gemini Response (Iteration 1 — Function Call)

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{
        "functionCall": {
          "name": "request_review",
          "args": { "review_type": "frontend" }
        }
      }]
    }
  }]
}
```

### Tool Callback Response (sent as `functionResponse`)

New dispatch:
```json
{ "status": "dispatched", "taskId": "task_a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
```

Dedup hit (review already in progress for this PR):
```json
{ "status": "already_running", "taskId": "task_existing-review-id" }
```

### Expected Gemini Response (Iteration 2 — Final Text)

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{
        "text": "Dispatched a frontend review for PR #1058. All 11 changed files are under apps/web/ — this is a major frontend redesign adding 2 new components (IssueGroupRow, IssueTimeline), rewriting CodeTasksPage, and adding a new utility module with 21 tests. Task ID: task_a1b2c3d4-e5f6-7890-abcd-ef1234567890."
      }]
    }
  }]
}
```

### GitHub Comment Posted by Code-Agent

```markdown
🔍 **GitHub Agent**

Dispatched a frontend review for PR #1058. All 11 changed files are under apps/web/ —
this is a major frontend redesign adding 2 new components (IssueGroupRow, IssueTimeline),
rewriting CodeTasksPage, and adding a new utility module with 21 tests.
Task ID: task_a1b2c3d4-e5f6-7890-abcd-ef1234567890.
```

### Review Agent System Prompt (Orchestrator)

This is the `reviewPrompt.build(params)` output in `system-prompt.ts`:

```
You are a code review agent for the IntexuraOS project. Your sole purpose is to review
pull request changes and provide structured feedback as GitHub PR comments.

## CRITICAL CONSTRAINTS

- You are REVIEW ONLY. You must NEVER commit, push, or modify any files.
- You must NEVER run git commit, git push, git add, or any write operations.
- You must NEVER approve or merge the PR via gh CLI.
- Your only output is GitHub PR comments via gh api.

## Task

{task.prompt}

## Step 1: Fetch PR Context

Run these commands to understand the PR:

```bash
gh pr view {prNumber} --json title,body,baseRefName,headRefName,files,additions,deletions
gh pr diff {prNumber}
gh api /repos/{repository}/pulls/{prNumber}/commits --jq '.[].commit.message'
```

Read the project's `.claude/CLAUDE.md` for coding standards (this is the single source of truth per `AGENTS.md`).

## Step 2: Spawn Review Subagents

Based on the review type, spawn subagents using the Agent tool. For "frontend" reviews,
spawn ALL 6 dimension agents below.

Each subagent MUST:
1. POST a "working..." comment: gh api /repos/{repository}/issues/{prNumber}/comments -f body="⏳ **{Dimension}** — reviewing..."
2. Analyze the PR diff for its dimension
3. PATCH the comment with structured findings: gh api -X PATCH /repos/{repository}/issues/comments/{commentId} -f body="..."

### Dimension 1: React Patterns

Focus: Component structure, hooks usage, SRP (~150 lines per component), memoization
(React.memo, useMemo, useCallback), state management, prop drilling, key usage in lists.

Prompt for subagent:
"You are reviewing PR #{prNumber} in {repository} for React patterns. Read the PR diff
with `gh pr diff {prNumber}`. Check every changed .tsx/.ts file for: component size
(flag >150 lines), proper hook usage (no hooks in conditionals), memoization where needed,
meaningful keys in lists, prop types. Post your findings as a GH comment."

### Dimension 2: TypeScript Strict Mode

Focus: noUncheckedIndexedAccess compliance (arr[0] ?? fallback), exactOptionalPropertyTypes,
strictBooleanExpressions (explicit === true, no implicit boolean coercion), String() for
template number interpolation.

Prompt for subagent:
"You are reviewing PR #{prNumber} for TypeScript strict mode compliance. Read the diff.
Flag: array access without ?? fallback, implicit boolean checks (if (value) instead of
if (value !== undefined)), missing String() around numbers in templates. These are
configured in tsconfig.json and enforced by CI."

### Dimension 3: TailwindCSS & Visual

Focus: Tailwind class consistency, responsive design (sm:/md:/lg:), dark mode support,
use of project UI primitives (not raw HTML), Lucide icons (not heroicons), consistent
spacing/color tokens.

Prompt for subagent:
"You are reviewing PR #{prNumber} for TailwindCSS and visual consistency. Read the diff.
Flag: inline styles instead of Tailwind, missing responsive classes, hardcoded colors
instead of theme tokens, missing dark mode variants, raw HTML elements that should use
project UI components."

### Dimension 4: UX Heuristics

Focus: Loading states, error states, empty states, user feedback (toasts/alerts), navigation
flow, accessibility (aria labels, keyboard nav, focus management), form validation.

Prompt for subagent:
"You are reviewing PR #{prNumber} for UX heuristics. Read the diff. Flag: missing loading
spinners, no error handling in data fetches, empty state not handled, no user feedback after
actions, missing aria-labels on interactive elements, click handlers without keyboard
equivalents."

### Dimension 5: Project Conventions

Focus: CLAUDE.md compliance, hash routing (/#/path), API client pattern (useApiClient),
env var naming (import.meta.env.INTEXURAOS_*), Auth0 integration, file organization.

Prompt for subagent:
"You are reviewing PR #{prNumber} for IntexuraOS project conventions. Read .claude/CLAUDE.md first,
then the diff. Flag: non-hash routes, direct fetch instead of useApiClient, wrong env var
prefix, missing logIncomingRequest, files >150 lines violating SRP."

### Dimension 6: Test Quality

Focus: Test coverage for utils/, services/, hooks/ (required by CLAUDE.md). Test isolation
(no shared state), cleanup in afterEach, Vitest patterns, meaningful assertions, edge cases.

Prompt for subagent:
"You are reviewing PR #{prNumber} for test quality. Read the diff. Check: are new utils/hooks
tested? Do tests clean up (afterEach)? Are assertions meaningful (not just toBeDefined)?
Are edge cases covered (empty arrays, null values, error paths)? Do test descriptions
match what they test?"

## Step 3: Output Final Summary

After ALL subagents complete, output a structured summary block:

```
REVIEW_AGENT_FINAL
findings_count: {total findings across all dimensions}
critical_count: {findings that would cause bugs or CI failure}
important_count: {findings that should be fixed}
suggestion_count: {nice-to-have improvements}
dimensions_reviewed: {comma-separated list of dimensions completed}
verdict: {approve|request_changes|comment}
summary: {2-3 sentence summary of overall review}
```

Verdict rules:
- approve: 0 critical, ≤2 important findings
- request_changes: any critical findings
- comment: no critical but >2 important findings
```

### Review Subagent Comment Examples (PR #1058)

**Initial POST** (immediately on spawn):
```markdown
⏳ **React Patterns** — reviewing...
```

**PATCH** (after analysis, replaces initial comment):
```markdown
## 🔍 React Patterns Review

**PR #1058** — Code Tasks List Redesign

### Findings

**Important:**
- `IssueGroupRow.tsx` (436 lines) exceeds SRP guideline of ~150 lines. Consider extracting
  `PipelineVisualization` and `OutputColumn` into separate components.

**Suggestions:**
- `CodeTasksPage.tsx:89` — `useMemo` dependency array includes `tasks` object reference.
  The merge-based refresh should provide stable references, but verify with React DevTools
  that the memo is actually preventing re-renders.
- `IssueTimeline.tsx:207` — The `archivedCount` computation could be memoized if the
  tasks array is large.

**Passing:**
- ✅ All hooks follow rules-of-hooks (no conditional hooks)
- ✅ React.memo with structural comparator on IssueGroupRow
- ✅ Proper key usage in list renders (task.id)
- ✅ useCallback for action handler

**Score: 85/100**
```

## Testing Strategy

### Tool Calling Infrastructure (packages)

| Component                                         | Test Approach                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ToolCallingClient` agent loop (`infra-gemini`)   | Unit test with mocked `@google/genai`. Verify: loop iterations, functionCall handling, error handling (all 6 modes), usage aggregation, maxIterations cap. Use `nock` or direct mock of `GoogleGenAI`. |
| `createToolCallingClient` factory (`llm-factory`) | Unit test: verify routing to `createGeminiToolCallingClient` for Google provider.                                                                                                                      |
| `createToolCallingClient` direct usage            | Tested indirectly via GitHub Agent use case tests (platform key passed, correct model).                                                                                                                |
| `ToolCallingModel` types (`llm-contract`)         | Compile-time only — TypeScript ensures correctness. Runtime: test `isToolCallingModel()` validator.                                                                                                    |

### GitHub Agent (code-agent)

| Component                        | Test Approach                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleGitHubEvent` use case     | Unit test with mock `ToolCallingClient`, mock `codeTaskRepo`, mock `gitHubPRClient`. Verify: tool calling invocation, comment posting (both dispatch and no-dispatch cases), error handling, dedup check, `parseOwnerRepo` null guard, `validateReviewType` rejection.       |
| `githubAgentPrompt`              | Unit test: verify `PromptBuilder` output contains required sections, has `version` field.                                                                                                                                                                                    |
| `buildEventMessage` helper       | Unit test: verify output format with various DiffContext shapes (truncated/non-truncated, empty patches). Verify strict mode compliance (String() wrapping).                                                                                                                 |
| `parseOwnerRepo` helper          | Unit test: valid `"owner/repo"` → `{ owner, repo }`, invalid `"noslash"` → `null`, empty string → `null`.                                                                                                                                                                    |
| `validateReviewType` helper      | Unit test: valid `{ review_type: 'frontend' }` → `'frontend'`, missing key → `null`, wrong type → `null`, invalid value → `null`.                                                                                                                                            |
| `gitHubPRHttpClient` new methods | Unit test with `nock`: mock GitHub API responses for `/pulls/{n}/files`, `/pulls/{n}/commits`, `/issues/{n}/comments`.                                                                                                                                                       |
| `GitHubPRClient` interface       | Verify new methods `getPullRequestFiles`, `getPullRequestCommits`, `postPRComment` compile and are mockable.                                                                                                                                                                 |
| Webhook routing                  | Integration test via `app.inject()`: verify `pull_request.opened` and `pull_request.synchronize` trigger GitHub Agent path (separate from existing rules pipeline). Verify `issue_comment.created` still routes through `ActionableEventRule` → `dispatchService` unchanged. |
| Review dispatch                  | Unit test: verify CodeTask creation (all required fields: `workerLocation`, `traceId`, `prNumber`, `agentType`), DispatchRequest assembly, dedup logic, at_capacity handling, workerLocation update after dispatch.                                                          |
| `dispatchReviewTask`             | Unit test: verify `generateWebhookSecret` reused from `domain/utils/secrets.ts`, verify `worker` resolved from `UserLookupService`, verify dispatch error → task marked `failed`.                                                                                            |

### Orchestrator

| Component                           | Test Approach                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `reviewPrompt.build()`              | Unit test: verify prompt contains review-only mandate, dimension definitions.      |
| `REVIEW_SCHEMA` + `ReviewAgentData` | Unit test: Zod parse with valid/invalid data.                                      |
| `selectSchemaAndPrompt` routing     | Unit test: verify `agentType: 'review'` routes to review schema/prompt.            |
| `CompletionVerifierVerdict`         | Unit test: verify `ReviewAgentData` is accepted in `agentData` union.              |
| `buildResultFromVerification`       | Unit test: verify `agentType === 'review'` maps `review_*` fields to `TaskResult`. |

## Files Changed

### New Infrastructure (packages)

| File                                                          | Change                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/llm-contract/src/toolCalling.ts`                    | **NEW** — ToolDefinition, ToolCallingClient, ToolCallingResult, ToolCallingMessage                                                                                         |
| `packages/llm-contract/src/index.ts`                          | Re-export all types from `toolCalling.ts` + `ToolCallingModel`/`isToolCallingModel` from `supportedModels.ts`                                                              |
| `packages/llm-contract/src/supportedModels.ts`                | Add `ToolCallingModel` type alias (subset of existing `LLMModel`), `ALL_TOOL_CALLING_MODELS`, `isToolCallingModel()`. No new model type — reuses existing `Gemini25Flash`. |
| ~~`packages/llm-contract/src/__tests__/fixtures/pricing.ts`~~ | No change — `gemini-2.5-flash` already in `TEST_GOOGLE_PRICING`                                                                                                            |
| `packages/llm-factory/src/llmClientFactory.ts`                | Add createToolCallingClient() factory                                                                                                                                      |
| `packages/llm-factory/src/index.ts`                           | Re-export `createToolCallingClient` from `llmClientFactory.ts`                                                                                                             |
| `packages/infra-gemini/src/toolCallingClient.ts`              | **NEW** — Gemini function calling loop + TOOL_CALLING_PRICING constant                                                                                                     |
| `packages/infra-gemini/src/client.ts`                         | Export createGeminiToolCallingClient()                                                                                                                                     |
| `packages/infra-gemini/src/index.ts`                          | Re-export `createGeminiToolCallingClient` from `client.ts`                                                                                                                 |
| ~~`packages/internal-clients/src/user-service/*`~~            | No change — `UserServiceClient` interface unchanged (platform key used directly via `createToolCallingClient`)                                                             |
### Code-Agent Changes

| File                                                            | Change                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/usecases/githubAgent.ts`            | **NEW** — GitHub Agent use case + dispatchReviewTask helper                                                     |
| `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`       | **NEW** — PromptBuilder with version: '1.0.0'                                                                   |
| `apps/code-agent/src/domain/models/codeTask.ts`                 | Add `'review'` to `AgentType` union + `review_*` fields to `TaskResult`                                         |
| `apps/code-agent/src/domain/services/taskDispatcher.ts`         | Add `'review'` to `DispatchRequest.agentType`                                                                   |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` | Add `'review'` to `CreateTaskInput.agentType` + `findActiveReviewForPR()` method                                |
| `apps/code-agent/src/domain/ports/gitHubPRClient.ts`            | Add `getPullRequestFiles()`, `getPullRequestCommits()`, `postPRComment()` to interface                          |
| `apps/code-agent/src/routes/webhooks/github.ts`                 | Add `pull_request.opened/synchronize` → GitHub Agent code path + extend `GitHubWebhookBody` with `base`/`head`  |
| `apps/code-agent/src/routes/codeRoutes.ts`                      | Add `'review'` to Fastify response schema enum                                                                  |
| `apps/code-agent/src/services.ts`                               | Add `githubAgentUseCase` to `ServiceContainer` + `ServiceConfig` + wiring (see ServiceContainer Wiring section) |
| `apps/code-agent/src/config.ts`                                 | Add `geminiApiKey` to `Config` interface and `loadConfig()` function (githubBotToken removed)                   |
| `apps/code-agent/src/index.ts`                                  | Add `INTEXURAOS_GEMINI_APP_API_KEY` to `REQUIRED_ENV` (INTEXURAOS_GITHUB_BOT_TOKEN removed)                     |
| `apps/code-agent/src/infra/http/gitHubPRHttpClient.ts`          | All methods use per-call token param; implement getPullRequestFiles/getPullRequestCommits/postPRComment         |
| `apps/code-agent/src/routes/webhookRoutes.ts`                   | Add `review_*` fields to `TaskCompleteWebhookBody.result` type (line 40)                                        |
| `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`      | Add `'review'` to `CreateTaskRequestInput.agentType`                                                            |
| `firestore.indexes.json`                                        | Add composite index: `code_tasks(repository, prNumber, agentType, status)` for `findActiveReviewForPR()`        |
| `terraform/environments/dev/main.tf`                            | Add `INTEXURAOS_GEMINI_APP_API_KEY` to code-agent env vars (INTEXURAOS_GITHUB_BOT_TOKEN removed)                |
| `ecosystem.config.cjs`                                          | Add `INTEXURAOS_GEMINI_APP_API_KEY` to code-agent config (INTEXURAOS_GITHUB_BOT_TOKEN removed)                  |

### Orchestrator Changes

| File                                                       | Change                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/system-prompt.ts`       | Add `'review'` branch in `buildSystemPrompt()` routing + `reviewPrompt: PromptBuilder<SystemPromptParams>`                                                |
| `workers/orchestrator/src/services/completion-verifier.ts` | Add `'review'` to `CompletionAgentType` + `ReviewAgentData` to verdict union + `REVIEW_SCHEMA` (Zod) + routing in `selectSchemaAndPrompt` + `toAgentData` |
| `workers/orchestrator/src/services/task-dispatcher.ts`     | Add `agentType === 'review'` branch in `buildResultFromVerification` (before `else` at line 1086)                                                         |
| `workers/orchestrator/src/types/task.ts`                   | Add `'review'` to `Task.agentType` + `review_*` fields to `TaskResult`                                                                                    |
| `workers/orchestrator/src/types/api.ts`                    | Add `'review'` to `CreateTaskRequest.agentType`                                                                                                           |
| `workers/orchestrator/src/types/schemas.ts`                | Add `'review'` to Zod enum                                                                                                                                |

### Web App Changes

| File                          | Change                               |
| ----------------------------- | ------------------------------------ |
| `apps/web/src/types/index.ts` | Add `'review'` to CodeTask agentType |

### Documentation

| File                                    | Change                          |
| --------------------------------------- | ------------------------------- |
| `docs/services/orchestrator/agent.md`   | Add `'review'` to agentType doc |

## Out of Scope

- User-configurable tool calling model (always `gemini-2.5-flash` for MVP)
- Reviewing non-web PRs (apps/web/ only for MVP)
- Visual regression testing
- Auto-fixing findings (review only)
- Workflow event handling (pull_request only for MVP)
- OpenAI/Anthropic tool calling providers (Gemini only for MVP)
- Priority queue for review tasks (shared capacity pool is sufficient for MVP)
- Per-iteration detail on ToolCallingResult (available via structured logs)
- Retry/backoff for Gemini API failures in agent loop (caller can retry)
- Token budget limits alongside maxIterations (Gemini 3 Flash has 1M context window)
- New `TaskStatus` value for reviews (reuse `'implemented'` for terminal success)
- Pricing is provisional — verify against actual Gemini API pricing at implementation time
