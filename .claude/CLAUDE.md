# CLAUDE.md

All rules verified by `pnpm run ci:tracked`. If CI passes, rules are satisfied. Keep this file compact — add references to `.claude/reference/`, don't inline details.

# Gates

**Commit Gate:** Before commit: (1) `pnpm run ci:tracked` passed completely? (2) Not saying "other services/workspaces"? (3) Not saying "unrelated to my changes" or "not caused by my code"? All YES = commit. Any NO = STOP.

**User Control:** The user controls, Claude executes. Questions/analysis/diagnosis → answer and STOP. Only act on explicit "implement", "fix", "do" instructions. Never auto-implement after analyzing, create commits after reviewing, fix issues during investigation, or scope-creep. Exception: only if user said "analyze AND fix" upfront.

**Ownership Mindset:** Own everything from task acceptance until CI passes. No "pre-existing", no "other services", no "my part passes". See `.claude/reference/ownership-mindset.md`

# Coding

**TypeScript:** Strict mode — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Use `arr[0] ?? fallback`, explicit `=== true`, `String()` for template numbers.

**Test-First:** Always write tests BEFORE implementation. Write failing test → confirm failure → implement minimal code → refactor. Exception: pure refactoring of existing tested code.

**Testing:** No external deps — in-memory fakes, `nock` for HTTP. Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`. Routes: `app.inject()`. Domain: unit tests. 100% branch coverage required — covered by tests (preferred) or `/* v8 ignore <CATEGORY> -- reason @preserve */` (last resort). Valid categories: `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`. Reference: `.claude/reference/coverage-exemptions.md`. Web app exception: coverage not enforced, tests optional for UI, required for `utils/`, `services/`, `hooks/`.
**v8 Ignore Proof:** explanation MUST name the testing BLOCKER, not describe the code. BAD: `-- error handling for failed request`. GOOD: `-- FakeHttpClient cannot simulate AbortError`. 

**Pre-Flight:** Read types BEFORE writing code. Before mocks: read `*Deps` type. Before ServiceContainer changes: read `services.ts`, search `setServices(` in tests, update all. Before imports: `pnpm build` if "Cannot find module". If build fails with missing dependencies: `pnpm install && pnpm build`. Before Result access: narrow with `if (!result.ok) return result;` first.

**Prompt Versioning:** All `PromptBuilder` prompts need a semver `version` field. Bump on edit: major = behavior change, minor = new examples, patch = typos.

**Code Auditing:** When fixing a pattern in one service, audit ALL other services for the same issue before committing.

**Linear MCP Safety:** Never broad text searches with high limits. Use `query: 'INT-445', limit: 10`. Children: `parentId`, not `includeRelations`. Context overflow → `/clear` and retry targeted. NEVER set `assignee`, `assigneeId`, or `delegate` on any issue — assignment is exclusively the user's responsibility. Enforced by PreToolUse hook.

# Architecture

**Overview:** `apps/` (Fastify, Cloud Run) | `workers/` (Cloud Functions) | `packages/` (common-_, infra-_) | `terraform/` | `docs/`. Apps use `services.ts` DI; workers use lightweight direct injection. Both require 95% coverage. Reference: `.claude/reference/architecture.md`

**Rules:** Apps can't import other apps. Routes use `getServices()`. Service communication via `/internal/{resource-name}` with `X-Internal-Auth`. All endpoints MUST use `logIncomingRequest()`. Pub/Sub: HTTP push only (no pull). Use cases MUST accept `logger: Logger`. Firestore: one collection owner per service, cross-service via HTTP, registry: `firestore-collections.json`. Migrations: IMMUTABLE — create new to fix bugs. Multi-field queries need composite indexes in `migrations/*.mjs`.

**Apps & Packages:** Apps: `getServices()`, `getFirestore()`, `INTEXURAOS_*` env vars, `validateRequiredEnv()`. New service: `/create-service`. Packages: `common-*` (leaf), `infra-*` (wrappers), no domain logic. Pub/Sub publishers MUST extend `BasePubSubPublisher`, topic names from env vars.

**Env Vars:** Three locations required: (1) `apps/<service>/src/index.ts` `REQUIRED_ENV`, (2) `terraform/environments/dev/main.tf`, (3) `ecosystem.config.cjs`. Reference: `.claude/reference/env-vars-patterns.md`.

**Web App:** Hash routing only (`/#/path`). TailwindCSS, `@auth0/auth0-react`, `useApiClient`, SRP ~150 lines, `import.meta.env.INTEXURAOS_*`. Dev: Vite proxies `/api/*`. Prod: absolute Cloud Run URLs.

# Workflow

**CI Failure:** Capture output with `tee /tmp/ci-output-*.txt`, analyze with `rg "error|FAIL" -C3`. Any failure in any workspace: fix it or ask user. Do not commit until ALL resolved.

**Verification:** Run from repo root. (1) `pnpm run verify:workspace:tracked -- <app-name>`. (2) Verify `packages/*/dist/` exists. (3) `pnpm run ci:tracked` must pass. Never modify `vitest.config.ts` coverage exclusions.

**Git & PR:** Commit Gate must pass before every commit. NEVER commit directly to `main` or `development` — both are protected branches (direct pushes are blocked by branch protection rules). Always create a feature branch and open a PR targeting `development`. Merge latest base branch before PR. Git worktrees NOT allowed.

**Cross-Linking:** PR titles contain `INT-XXX`. PR body: `Fixes INT-XXX`. NEVER fabricate issue IDs — ask the user if none provided. Reference: `.claude/reference/cross-linking.md`

**Infrastructure:** ALL via Terraform. GCP project: `--project=intexuraos-dev-pbuchman`. SA key: `$HOME/.config/gcloud/sa-key.json`. Reference: `.claude/reference/infrastructure.md`

**Environments:** dev=`dev.intexuraos.cloud` (PM2, home-dev) | prod=`intexuraos.cloud` (Cloud Run). No "local". Firestore shared. Reference: `.claude/reference/environments.md`

**Code Task Investigation:** When user pastes `dev.intexuraos.cloud/#/code-tasks/task_*` or `intexuraos.cloud/#/code-tasks/task_*` URL — use `/debug-code-task` skill. NEVER WebFetch/curl the SPA URL (hash routing returns shell HTML). Data is in Firestore `code_tasks` collection.

**User Communication:** ALWAYS use the `AskUserQuestion` tool for questions — never inline questions in text responses. If multiple questions are needed, aggregate them into a single multi-part `AskUserQuestion` call. Non-negotiable.

**Git CLI:** Always prefer `gh` CLI over raw `git` commands. Use `gh` for status, diff, log, branching, PRs, and any operation `gh` supports. Fall back to `git` only when `gh` has no equivalent.

**Full Investigation:** NEVER present partial investigation results with hedging language ("maybe", "possibly", "there are multiple possible causes", "could be"). Always perform complete investigation with all mandatory evidence before presenting findings. Present definitive root cause backed by concrete evidence (logs, code, config). If evidence is genuinely insufficient, say exactly what evidence is missing and fetch it — do not guess. Non-negotiable.

**Investigation Discipline:** When a tool, binary, or service crashes: (1) investigate the environment (arch, resources, config), not the tool. (2) Trace the causal chain to fixable code — surface symptoms are not root causes; keep asking "why?". (3) Diagnosis without fix is incomplete — implement and verify the fix. (4) During dev-env incident triage, act immediately (rebuild images, restart services) without asking permission. (5) Confident speculation is a violation — "crashes because X" without evidence is as wrong as "maybe X". Reference: `.claude/reference/investigation-discipline.md`

**Plan Documentation:** Plans with HTTP endpoints MUST include "Endpoint Changes" section: Modified, Created, Removed, Unchanged.
