# Multi-Repository Support for IntexuraOS Code Agent - Current-Code Investigation and Plan

> **Status:** Revalidated on 2026-06-15 against the current repository. This is an effort-scoping and implementation-sequencing plan, not an executable TDD plan.
>
> **Linear:** [INT-1423](https://linear.app/pbuchman/issue/INT-1423/evaluate-requirements-for-multi-repository-support-in-code-agent)
>
> **Revision note:** This update replaces stale path and line references from the original 2026-04-20 plan, restores the occurrence audit, and adds the required subagent planning, review, implementation, and remediation process.

---

## 1. Executive Summary

Users should be able to create a code task against a repository they have connected, not only `pbuchman/intexuraos`. The current system is not ready for that as a small toggle because the task model and some PR-derived flows carry repository metadata, but the runtime is still built around a single bootstrap repository and a single GitHub App installation.

The central architecture conclusion remains valid: multi-repo support is an orchestrator, authorization, worker-bootstrap, code-agent, web, and Firestore re-architecture. The implementation should make the orchestrator repo-agnostic and make each task dispatch carry the repository identity, clone URL, base branch, and GitHub App installation context needed to run that task.

The updated investigation found several stale or wrong old claims:

- Orchestrator single-repo setup now lives in `workers/orchestrator/src/bootstrap/env-config.ts`, `workers/orchestrator/src/start.ts`, and `workers/orchestrator/src/bootstrap/service-wiring.ts`, not the old `start.ts` line references.
- The active installation env var is `INTEXURAOS_GITHUB_INSTALLATION_ID`, not an `_APP_INSTALLATION_ID` variant.
- Per-task token files already exist; the remaining blocker is that the installation ID source is still singleton.
- The code-worker Dockerfile no longer runs `pnpm install` unconditionally. Runtime install is conditional in `docker/code-worker/entrypoint.sh`.
- Additional blockers now need to be in scope: Ask Agent repo scope, webhook repository filtering, Merge Queue hardcoding, prompt/final CI hardcoding, and entrypoint mutation of `/repo/.claude/settings.local.json`.

### Effort Estimate

| Workstream | Effort | Risk |
| --- | ---: | --- |
| A. Connected repository model, access control, and API | 3-4 d | Medium |
| B. GitHub App installation mapping and token pool | 3-5 d | High |
| C. Orchestrator per-task repo cache, clone validation, and worktrees | 6-8 d | High |
| D. Worker bootstrap and prompt/verification decoupling | 3-4 d | Medium |
| E. Code-agent submit, Ask Agent, action, webhook, and queue plumbing | 3-4 d | Medium |
| F. Web repository selector, settings, filters, and Merge Queue updates | 3-4 d | Medium |
| G. Firestore indexes, migrations, security documentation, and tests | 2-3 d | Medium |
| H. Docs, rollout, pilot external repos, and operational runbooks | 2 d | Low |
| **Total** | **25-34 d** | |

Calendar estimate: 5-7 weeks with one senior full-stack engineer, or roughly 3-4 weeks with parallel subagents working against approved slice plans.

### MVP vs. Full Product

MVP private preview:

- One extra repository connected through an existing GitHub App installation.
- Repository selector in task creation and repository-aware dispatch.
- Orchestrator lazily clones and runs worktrees per task repository.
- Repo-specific verification command can default to current IntexuraOS behavior only for `pbuchman/intexuraos`.

Full product:

- Users connect repositories through the GitHub App install flow.
- Every task creation path validates a connected repository record.
- The orchestrator caches multiple repositories and installation tokens.
- Web list, Ask Agent, Merge Queue, PR review, retries, and queue drain flows are repository-aware.

---

## 2. Two-Pass Verification Results

### Pass 1: Existing Plan Claim-by-Claim Against Current Code

The main architectural claims remain true, but the original evidence was stale. These claims are still valid and must remain in the plan:

- The orchestrator binds to one repo at bootstrap: `workers/orchestrator/src/start.ts:95`, `:101`, and `:138`.
- Repo URL/path are global env config: `workers/orchestrator/src/bootstrap/env-config.ts:141` and optional path at `:201`.
- GitHub App installation is singleton config: `workers/orchestrator/src/bootstrap/env-config.ts:146`, `workers/orchestrator/src/bootstrap/service-wiring.ts:102`, and `workers/orchestrator/src/github/token-service.ts:21`.
- `WorktreeManager` is wired to one repository path: `workers/orchestrator/src/bootstrap/service-wiring.ts:118`, `workers/orchestrator/src/services/worktree-manager.ts:23`, and `:112`.
- `CodeTask` already carries `repository` and `baseBranch`: `apps/code-agent/src/domain/models/codeTask.ts:275`.
- Public submit and Ask Agent still default to IntexuraOS: `apps/code-agent/src/routes/code/task-routes.ts:1686`, `apps/code-agent/src/domain/usecases/processCodeAction.ts:365`, and `apps/code-agent/src/domain/usecases/startAskAgent.ts:87`.
- Web submit has no repository field: `apps/web/src/types/index.ts:1124` and `apps/web/src/pages/CodeTaskNewPage.tsx:204`.
- Firestore has `code_tasks` but no `connected_repositories` collection: `firestore-collections.json:141`.

The old plan claims that must be corrected:

- Replace all old `start.ts:442`, `:539`, and `:564` style references with current bootstrap and wiring files.
- Replace `INTEXURAOS_GITHUB_APP_INSTALLATION_ID` with `INTEXURAOS_GITHUB_INSTALLATION_ID`.
- Do not say the worker token path is a single `/secrets/github-token` source. The orchestrator already writes per-task secrets at `workers/orchestrator/src/services/isolation/token-refresher.ts:112`; the singleton is the installation ID and service wiring.
- Do not say Dockerfile install is unconditional. `docker/code-worker/Dockerfile:50` prepares pnpm tooling; `docker/code-worker/entrypoint.sh:522` conditionally runs `pnpm install` when `/repo/pnpm-lock.yaml` exists.
- Do not treat `.github/CODEOWNERS` as an external-repo PR leak. It is target-repo metadata unless the worker edits it.
- Do not conflate Cloud Build GitHub connection configuration with the GitHub App installation model used by code tasks.

### Pass 2: Fresh Investigation From Current Codebase

Starting from the current repository structure produces this workstream map:

1. Replace the orchestrator's single startup clone with a per-task repository cache.
2. Remove IntexuraOS-only repo validation and branch cleanup defaults from repo/worktree management.
3. Resolve GitHub App installation IDs from connected repository records and mint tokens per task/install.
4. Make worker bootstrap portable and prevent runtime mutation of target-repo `.claude/` files unless explicitly allowed.
5. Add repository and base-branch fields to public submit, internal submit, internal process, and Ask Agent start flows.
6. Replace hardcoded webhook repository allowlists with connected-repository validation.
7. Add web repository selection, filtering, and settings UI.
8. Add `connected_repositories`, repository-aware Firestore indexes, and server-side access checks.
9. Update prompts and completion schemas so verification commands are repo-specific instead of always `pnpm run ci:tracked`.
10. Keep GitHub Enterprise and non-GitHub providers as explicit non-goals.

---

## 3. Current Architecture and Blockers

### 3.1 Orchestrator Bootstrap and Service Wiring

The orchestrator still starts with one repository and one installation:

| Area | Current evidence | Blocker |
| --- | --- | --- |
| Repo URL | `workers/orchestrator/src/bootstrap/env-config.ts:141` reads `INTEXURAOS_REPOSITORY_URL`. | One process cannot choose a repo per task. |
| Repo path | `workers/orchestrator/src/start.ts:95`, `:101`, `:138` derive one repo path and call `ensureRepository` once. | All worktrees come from the same source clone. |
| Installation ID | `workers/orchestrator/src/bootstrap/env-config.ts:146` reads `INTEXURAOS_GITHUB_INSTALLATION_ID`. | One GitHub App installation cannot represent arbitrary repos/orgs. |
| Token service | `workers/orchestrator/src/bootstrap/service-wiring.ts:102` constructs one `GitHubTokenService`. | Token minting is not keyed by task repository/install. |
| Worktree manager | `workers/orchestrator/src/bootstrap/service-wiring.ts:118` constructs one `WorktreeManager` with one `repositoryPath`. | `repository` in the task payload is metadata, not checkout input. |
| Settings template | `workers/orchestrator/src/bootstrap/service-wiring.ts:87` resolves the template from `<repo>/docker/code-worker/config-defaults/settings.local.json`. | External repos will not ship IntexuraOS worker defaults. |

Additional orchestrator blockers:

- `workers/orchestrator/src/services/repo-manager.ts:112` rejects repositories whose `package.json` name is not `intexuraos`.
- `workers/orchestrator/src/services/repo-manager.ts:196` still resets cleanup state to `origin/development`.
- `workers/orchestrator/src/services/task-dispatcher.ts:317` has `getDefaultRepository: () => 'pbuchman/intexuraos'`.
- `workers/orchestrator/src/types/api.ts:7` and `workers/orchestrator/src/types/schemas.ts:57` accept `repository` and `baseBranch`, but do not carry `repoUrl` or `installationId`.

### 3.2 Token Refresh and GitHub App Auth

The token refresher already writes per-task token files, but it mints every token from one configured installation:

- Config shape is single-installation: `workers/orchestrator/src/services/isolation/token-refresher.ts:7`.
- Token minting uses that one installation ID: `workers/orchestrator/src/services/isolation/token-refresher.ts:72`.
- Per-task secret paths already exist: `workers/orchestrator/src/services/isolation/token-refresher.ts:112`.

The fix is not "make `/secrets/github-token` per task"; that is already partly true. The fix is a `GitHubTokenPool` or equivalent service keyed by installation ID, with the task dispatch carrying the installation selected by the code-agent.

### 3.3 Code-Agent Task Creation and Dispatch

The task model is partially ready, but task creation paths are not:

| Flow | Current evidence | Required change |
| --- | --- | --- |
| Public submit | `apps/code-agent/src/routes/code/task-routes.ts:1422`, `:1686` | Accept repository/baseBranch, validate connected repo, persist selected repo. |
| Internal submit | `apps/code-agent/src/routes/code/task-routes.ts:435`, `:623` | Add repository/baseBranch or explicit legacy default path. |
| Internal process | `apps/code-agent/src/routes/code/task-routes.ts:160`, `:188`, `apps/code-agent/src/domain/usecases/processCodeAction.ts:209`, `:365` | Stop defaulting silently to `pbuchman/intexuraos`; require validated repository context for new tasks. |
| Ask Agent | `apps/code-agent/src/routes/code/ask-agent-routes.ts:24`, `:150`, `apps/code-agent/src/domain/usecases/startAskAgent.ts:87` | Add repository/baseBranch to request and active-session scoping. |
| Queue drain | `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:893`, `apps/code-agent/src/domain/usecases/drainRetryQueue.ts:712` | Preserve task repository and include installation/clone context in dispatch. |
| PR review/remediation | `apps/code-agent/src/domain/usecases/createReviewTask.ts:498`, `apps/code-agent/src/domain/usecases/createRemediationTask.ts:150` | Keep dynamic repository handling but validate against connected repository records. |

Downstream dispatch currently forwards `repository` and `baseBranch`, but not clone URL or installation context: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts:54` and `:118`.

### 3.4 GitHub Webhook and PR Dispatch

Webhook-derived flows are closer than manual submit because they can carry the event repository. The current blocker is the gate that decides which repositories are allowed:

- `apps/code-agent/src/infra/github-event-parser.ts:14` only allows `intexuraos/*` and `*/intexuraos` style repositories.
- `apps/code-agent/src/domain/usecases/processGitHubWebhook.ts:132` applies that filter before dispatch logic can create tasks.
- `apps/code-agent/src/services.ts:93` notes that `RepositoryScopeRule` is not wired because the route handler already filters.
- `apps/code-agent/src/domain/services/gitHubDispatch/prTaskHelpers.ts:27` has an `owner === 'intexuraos'` special case.

The webhook gate must be replaced by connected-repository validation. The allowed repository set should come from installation/repository records, not regexes.

### 3.5 Worker Runtime and Prompts

The worker image is mostly portable, but runtime behavior still assumes IntexuraOS conventions:

- `docker/code-worker/entrypoint.sh:477` conditionally runs `/repo/scripts/sync-secrets.sh` if it exists. For arbitrary external repos this is not safe: it executes target-repo-controlled code during bootstrap while worker credentials are mounted. It must be restricted to trusted IntexuraOS repos or replaced with an explicit, reviewed repo bootstrap hook.
- `docker/code-worker/entrypoint.sh:522` conditionally runs `pnpm install` when `/repo/pnpm-lock.yaml` exists. This is safer than the old plan claimed, but still lacks a repo-declared bootstrap hook.
- `docker/code-worker/entrypoint.sh:550` creates or mutates `/repo/.claude/settings.local.json`. That writes IntexuraOS worker settings into the target repo worktree and must be moved out of target-repo tracked paths or made explicitly ephemeral.
- Prompt/final schemas hardcode IntexuraOS verification:
  - `workers/orchestrator/src/services/prompts/execution-prompt.ts:102` says to run `pnpm run ci:tracked`.
  - `workers/orchestrator/src/services/prompts/pull-request-prompt.ts:139` requires CI evidence of `pnpm run ci:tracked successful`.
  - `workers/orchestrator/src/services/prompts/pr-review-overlay-prompt.ts:83` repeats that final evidence.

External repositories need repo-specific verification commands. The connected repository record should define either a default verification command or a policy that can fall back to framework detection.

### 3.6 Web UI

The web task type can display repository information, but submit and filters cannot select it:

- `apps/web/src/types/index.ts:1064` includes task repository/base branch on the returned task type.
- `apps/web/src/types/index.ts:1124` omits repository/baseBranch from `SubmitCodeTaskRequest`.
- `apps/web/src/pages/CodeTaskNewPage.tsx:204` builds a submit payload without repo fields.
- `apps/web/src/services/codeAgentApi.ts:72` lists tasks with status/limit/cursor only.
- `apps/web/src/pages/CodeTasksPage.tsx:247` has list/filter state but no repository filter.
- `apps/web/src/services/codeAgentApi.ts:309` and `apps/web/src/hooks/useAskAgent.ts:118` start Ask Agent with only a prompt.
- `apps/web/src/pages/MergeQueuePage.tsx:13` hardcodes `DEFAULT_OWNER='pbuchman'` and `DEFAULT_REPO='intexuraos'`.

Display links that already use `task.repository` should remain dynamic.

### 3.7 Firestore, Access Control, and Indexes

The current schema has `code_tasks`, `code_worker_settings`, and GitHub event collections, but no connected repository collection:

- `firestore-collections.json:141` documents `code_tasks`.
- `migrations/033_code-tasks-initial-indexes.mjs:41` has user/status/createdAt indexes for task lists.
- Existing PR-centric indexes already include repository/prNumber for review flows.
- `migrations/083_code-tasks-ask-agent-active-query-index.mjs:20` is user/agent/status/createdAt and is repo-blind.
- `firestore.rules:70` makes code task access user-owned; repository access must be enforced server-side because clients do not directly write code tasks.

Multi-repo requires:

- A new `connected_repositories` collection.
- Server-side validation on every task creation path.
- Repository-aware task list and active Ask Agent indexes.
- Historical task visibility preserved after disconnecting a repository.

### 3.8 Infrastructure and Environment

Runtime task routing and build/deploy configuration are separate concerns:

- `.envrc.local.example:190` and `:193` still expose single runtime repository URL/path examples.
- `terraform/environments/dev/main.tf:548` still documents runtime GitHub App/private-key/repository secrets.
- `terraform/environments/dev/main.tf:554` describes `INTEXURAOS_GITHUB_INSTALLATION_ID` as the installation for `pbuchman/intexuraos`.
- `terraform/variables.tf:18`, `:23`, and `:29` define GitHub owner/repo/branch for the IntexuraOS build pipeline.
- `terraform/modules/cloud-build/main.tf:38` uses those build variables for Cloud Build, not task runtime selection.
- GitHub user identity already has OAuth connection endpoints in `apps/user-service/src/routes/gitHubOAuthConnectionRoutes.ts`; this is related identity state, not a substitute for GitHub App installation records used by workers.

Do not remove build pipeline owner/repo variables as part of multi-repo task support. They still describe how IntexuraOS itself is built.

---

## 4. Target Architecture

Every task should resolve to a validated connected repository before dispatch:

```text
User or webhook
  -> code-agent validates connected repository access
  -> CodeTask stores repository, baseBranch, repositoryConnectionId
  -> dispatch carries repository, repoUrl, baseBranch, installationId, verificationProfile
  -> orchestrator resolves clone cache and token pool per dispatch
  -> worker receives a worktree and ephemeral credentials for that repository
```

### Core Design Decisions

1. **Connected repository registry**
   - Store repository full name, GitHub repository ID, default branch, clone URL, installation ID, installation account, connected user, allowed users/org/team metadata, status, verification command/profile, and timestamps.
   - Do not accept arbitrary repository strings at task submission time.

2. **Per-task dispatch contract**
   - Extend orchestrator dispatch from `{ taskId, repository?, baseBranch? }` to include `{ repository, repoUrl, baseBranch, installationId, verificationProfile }`.
   - Keep a temporary legacy default for existing IntexuraOS-only callers, but log it and remove it after migration.

3. **Repo clone cache**
   - Cache clones under an orchestrator-owned path keyed by normalized owner/repo or GitHub repo ID.
   - Guard fetches with a per-repo mutex.
   - Remove IntexuraOS package-name validation and hardcoded `origin/development` cleanup.

4. **Installation token pool**
   - Build a token service keyed by installation ID.
   - Continue writing per-task token files, but mint each token from the repository's installation.

5. **Worker runtime defaults outside target repo**
   - Move settings defaults out of the target repository and into orchestrator/worker-owned config.
   - Treat target repo `.claude/` and `.intexuraos/config.yaml` as optional enhancements, not requirements.
   - Do not mutate target-repo tracked config as a side effect of startup.

6. **Repo-specific verification**
   - Replace hardcoded final evidence text with a verification command selected from connected repository config or task metadata.
   - Keep `pnpm run ci:tracked` as the IntexuraOS default only.

---

## 5. Endpoint Changes

### Modified

| Endpoint | Change |
| --- | --- |
| `POST /submit` | Add `repository` and optional `baseBranch`; validate against connected repositories before creating a task. |
| `GET /tasks` | Add optional repository filter and update index/query shape. |
| `POST /internal/code/submit` | Carry repository/baseBranch or use an explicit legacy IntexuraOS migration path. |
| `POST /internal/code/submit-phase2` | Preserve and validate repository context when submitting implementation-phase work. |
| `POST /internal/code/process` | Stop silently defaulting repo for new flows; require validated repository context where possible. |
| `POST /ask-agent/start` | Add repository/baseBranch and scope active Ask Agent sessions per repo. |
| `GET /ask-agent/active` | Add repository filter or return per-repo active sessions. |
| `POST /tasks/:taskId/implement` | Inherit repository context from the source task and include dispatch installation context. |
| `POST /retry` | Validate inherited task repository before creating retry attempts. |
| `POST /tasks/:taskId/feedback` | Preserve repository/baseBranch for feedback-created follow-up tasks. |
| Orchestrator `POST /tasks` | Add `repoUrl`, `installationId`, and verification profile/command to dispatch payload. |
| GitHub webhook processing | Replace regex repository allowlist with connected-repository lookup. |

### Created

| Endpoint | Purpose |
| --- | --- |
| `GET /repositories` | List repositories connected and available to the current user. |
| `POST /repositories/connect/callback` | Persist repositories returned by the GitHub App installation callback. |
| `DELETE /repositories/:id` | Disconnect a repository for future tasks while preserving historical tasks. |

### Removed

None.

### Unchanged

- Task detail endpoints that already return `CodeTask.repository`.
- PR and issue-group links that already build GitHub URLs from `task.repository`.
- Existing user-service GitHub OAuth identity endpoints: `POST /oauth/connections/github/initiate`, `GET /oauth/connections/github/callback`, `GET /oauth/connections/github/status`, and `DELETE /oauth/connections/github`.
- Cloud Build endpoints and Terraform variables used to build/deploy IntexuraOS itself.

---

## 6. Implementation Task Separation

The implementation agent for this plan should be an orchestrator. It should not personally implement every slice. It should spawn focused subagents, integrate their work, run final verification, and own cross-slice consistency.

Every slice must use this loop:

1. A planning subagent investigates its slice and writes a slice plan with current file references, test strategy, and migration risks.
2. The planning subagent requests review on that slice plan.
3. The planning subagent revises the slice plan until the reviewer accepts it as implementation-ready.
4. A new implementation subagent starts from the approved slice plan.
5. The implementation subagent makes scoped changes only in its ownership area.
6. A review subagent reviews the implementation for correctness, tests, migrations, and integration risks.
7. The implementation subagent remediates review findings and repeats review until there are no blocking findings.
8. The orchestrator integrates approved slices, resolves cross-slice contract mismatches, and runs repository-wide verification.

### Slice A: Connected Repository Model and Access

Ownership:

- `apps/code-agent/src/domain/**`
- `apps/code-agent/src/infra/firestore/**`
- `firestore-collections.json`
- Firestore migrations and rules documentation

Deliverables:

- `ConnectedRepository` domain model and serializer.
- Repository connect/list/disconnect use cases.
- Server-side validation service used by every task creation path.
- Access policy for historical tasks after disconnect.
- Tests for authorization, missing repo, disconnected repo, and legacy IntexuraOS fallback.

### Slice B: GitHub App Installation and Token Routing

Ownership:

- `apps/code-agent/src/domain/services/**github**`
- `apps/code-agent/src/infra/**github**`
- `workers/orchestrator/src/github/**`
- `workers/orchestrator/src/services/isolation/token-refresher.ts`

Deliverables:

- Installation ID stored per connected repository.
- Dispatch carries installation ID.
- Orchestrator token pool keyed by installation ID.
- Token refresh lifecycle tests for two concurrent installations.

### Slice C: Orchestrator Repo Cache and Worktrees

Ownership:

- `workers/orchestrator/src/services/repo-manager.ts`
- `workers/orchestrator/src/services/worktree-manager.ts`
- `workers/orchestrator/src/bootstrap/**`
- `workers/orchestrator/src/types/**`
- Orchestrator tests

Deliverables:

- Repo cache keyed by repository ID or normalized owner/repo.
- Per-repo fetch mutex.
- Worktree creation accepts repository path per call.
- Removal of package-name validation and `origin/development` cleanup.
- Dispatch contract accepts repo URL and installation context.

### Slice D: Worker Bootstrap, Prompts, and Verification

Ownership:

- `docker/code-worker/**`
- `workers/orchestrator/src/services/prompts/**`
- Worker config defaults

Deliverables:

- Settings defaults no longer sourced from target repo.
- Entry point no longer writes tracked target-repo config unless explicitly allowed.
- Repo bootstrap command is selected from `.intexuraos/config.yaml`, connected-repo config, or safe autodetection.
- Final evidence prompts support repo-specific verification commands.

### Slice E: Code-Agent Task Creation and Webhook Flows

Ownership:

- `apps/code-agent/src/routes/code/**`
- `apps/code-agent/src/domain/usecases/processCodeAction.ts`
- `apps/code-agent/src/domain/usecases/startAskAgent.ts`
- `apps/code-agent/src/domain/usecases/submitToExecutionAgent/**`
- `apps/code-agent/src/domain/usecases/fanOutChildTasks.ts`
- `apps/code-agent/src/domain/usecases/retryTask.ts`
- `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`
- Queue drain/retry/review/remediation use cases
- Webhook parser and dispatch services

Deliverables:

- Public/internal submit accept and validate repository context.
- Ask Agent is repository-scoped.
- Implementation, retry, feedback, and child-task creation inherit and validate source task repository context.
- Webhook filtering uses connected repository records.
- Existing PR-derived repository metadata continues to flow through retries and remediations.

### Slice F: Web Repository UX

Ownership:

- `apps/web/src/pages/CodeTaskNewPage.tsx`
- `apps/web/src/pages/CodeTasksPage.tsx`
- `apps/web/src/pages/AskAgentPage.tsx`
- `apps/web/src/pages/MergeQueuePage.tsx`
- `apps/web/src/services/codeAgentApi.ts`
- `apps/web/src/types/index.ts`

Deliverables:

- Repository selector in task creation and Ask Agent.
- Repository filters in task list.
- Repository settings page for connect/disconnect.
- Merge Queue no longer hardcodes `pbuchman/intexuraos`.
- UI tests for selected repo submission and filtering.

### Slice G: Firestore Indexes, Migration, and Rollout

Ownership:

- `migrations/**`
- `firestore.indexes.json`
- `firestore.rules`
- Release and rollout docs

Deliverables:

- `connected_repositories` collection entry.
- Repository-aware indexes for task lists and Ask Agent active queries.
- Backfill/migration strategy for existing IntexuraOS tasks.
- Rollout checklist and pilot repo validation steps.

---

## 7. Rollout Plan

1. Land the connected repository model and read-only listing with `pbuchman/intexuraos` pre-seeded.
2. Add repository fields to web submit and code-agent routes while still defaulting legacy callers explicitly.
3. Add orchestrator repo cache and installation token pool behind `INTEXURAOS_MULTI_REPO=1`.
4. Update prompts and worker bootstrap to use repo-specific verification and safe target-repo config behavior.
5. Enable dev with one pilot external repository in the same GitHub installation.
6. Add GitHub App installation callback and test a repository in a different installation account.
7. Enable production behind a repo allowlist and monitor clone cache size, token refresh failures, webhook drops, and task success rate.

---

## 8. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Clone cache disk growth | Add cache size metrics, LRU cleanup, and per-repo fetch locks. |
| Incorrect repo access | Validate every task through connected repository records and GitHub installation metadata. |
| Wrong installation token | Key token pool by installation ID and add tests for two repos in different installations. |
| Worker mutates external repo config | Keep worker defaults outside target repo and write only ephemeral runtime files. |
| Repo without Node/pnpm support | Use repo-declared bootstrap or safe autodetect/no-op fallback. |
| Existing IntexuraOS tasks regress | Keep explicit legacy fallback during migration and test IntexuraOS end to end. |
| Webhook spam from unconnected repos | Replace regex allowlist with connected-repo lookup before task creation. |
| Ask Agent cross-repo collision | Scope active Ask Agent sessions by user and repository. |
| Hardcoded final CI evidence | Make verification evidence text dynamic from task/repo verification command. |

---

## 9. Non-Goals

- GitHub Enterprise or self-hosted GitHub support.
- GitLab, Bitbucket, or other providers.
- Anonymous or read-only public repo task submission.
- Per-repo worker Docker images.
- Full per-tenant infrastructure isolation in the first release.
- Rewriting historical immutable migrations that mention `pbuchman/intexuraos`.

---

## 10. Appendix A - Occurrence Audit

Classifications:

- `R-CHANGE`: runtime behavior that must change.
- `R-PARAM`: runtime behavior that can stay if it is parameterized from task/repo context.
- `M-META`: IntexuraOS build/deploy metadata, not target-repo task routing.
- `D-DISPLAY`: display-only link/text that is already data-driven or should remain GitHub.com-only for now.
- `T-FIXTURE`: tests or fixtures that should gain external-repo coverage but are not runtime blockers.
- `N-NOTE`: historical note, immutable migration, or documentation context.

| Occurrence | Classification | Action |
| --- | --- | --- |
| `workers/orchestrator/src/bootstrap/env-config.ts:141` `INTEXURAOS_REPOSITORY_URL` | `R-CHANGE` | Stop requiring one runtime repo URL for all tasks. |
| `workers/orchestrator/src/bootstrap/env-config.ts:146` `INTEXURAOS_GITHUB_INSTALLATION_ID` | `R-CHANGE` | Replace singleton install source with connected-repo installation routing. |
| `workers/orchestrator/src/start.ts:95`, `:101`, `:138` single repo path and `ensureRepository` | `R-CHANGE` | Lazily ensure/cache the selected task repository. |
| `workers/orchestrator/src/bootstrap/service-wiring.ts:87` settings template from target repo | `R-CHANGE` | Move runtime settings defaults out of target repo. |
| `workers/orchestrator/src/bootstrap/service-wiring.ts:102`, `:118` singleton token/worktree services | `R-CHANGE` | Wire token pool and repo-aware worktree manager. |
| `workers/orchestrator/src/services/repo-manager.ts:112` package name `intexuraos` validation | `R-CHANGE` | Remove or limit to legacy bootstrap validation. |
| `workers/orchestrator/src/services/repo-manager.ts:196` `origin/development` cleanup | `R-CHANGE` | Use task base branch/default branch. |
| `workers/orchestrator/src/services/task-dispatcher.ts:317` default `pbuchman/intexuraos` | `R-CHANGE` | Replace with explicit legacy fallback only during migration. |
| `workers/orchestrator/src/types/api.ts:7`, `schemas.ts:57` dispatch lacks repo URL/install ID | `R-CHANGE` | Extend dispatch contract. |
| `workers/orchestrator/src/services/isolation/token-refresher.ts:7`, `:72` singleton install ID | `R-CHANGE` | Key refresh by installation ID. |
| `workers/orchestrator/src/services/isolation/token-refresher.ts:112` per-task token file | `R-PARAM` | Keep; mint from correct installation. |
| `workers/orchestrator/src/services/prompts/execution-prompt.ts:102` `pnpm run ci:tracked` | `R-CHANGE` | Use repo-specific verification command. |
| `workers/orchestrator/src/services/prompts/pull-request-prompt.ts:139` hardcoded final CI evidence | `R-CHANGE` | Make evidence label dynamic. |
| `workers/orchestrator/src/services/prompts/pr-review-overlay-prompt.ts:83` hardcoded final CI evidence | `R-CHANGE` | Make evidence label dynamic. |
| `apps/code-agent/src/domain/models/codeTask.ts:275` repository/baseBranch fields | `R-PARAM` | Keep and extend with connection/verification context. |
| `apps/code-agent/src/routes/code/task-routes.ts:1686` public submit `pbuchman/intexuraos` | `R-CHANGE` | Accept and validate selected repo. |
| `apps/code-agent/src/domain/usecases/processCodeAction.ts:209`, `:365` IntexuraOS defaults | `R-CHANGE` | Require or resolve validated repository context. |
| `apps/code-agent/src/domain/usecases/startAskAgent.ts:87` IntexuraOS default | `R-CHANGE` | Add repository-scoped Ask Agent. |
| `apps/code-agent/src/infra/services/taskDispatcherImpl.ts:54`, `:118` forwards repo/base only | `R-CHANGE` | Include repo URL and installation context. |
| `apps/code-agent/src/infra/github-event-parser.ts:14` repository regex allowlist | `R-CHANGE` | Replace with connected repository lookup. |
| `apps/code-agent/src/domain/usecases/processGitHubWebhook.ts:132` applies regex gate | `R-CHANGE` | Validate installation/repository record. |
| `apps/code-agent/src/domain/services/gitHubDispatch/prTaskHelpers.ts:27` `owner === 'intexuraos'` | `R-CHANGE` | Use connected repository primary owner/account metadata. |
| `apps/code-agent/src/domain/services/gitHubDispatch/ciFailureDispatch.ts:81` GitHub.com PR URL | `D-DISPLAY` | Keep for GitHub.com-only scope. |
| `apps/code-agent/src/domain/issueGrouping/labelHelpers.ts:100` dynamic task repo URL | `D-DISPLAY` | Keep. |
| `apps/code-agent/src/domain/constants/gitHubBots.ts:8` IntexuraOS bot names | `R-PARAM` | Keep if one GitHub App bot owns all connected repos; revisit if multiple apps. |
| `apps/web/src/types/index.ts:1124` submit request lacks repository | `R-CHANGE` | Add repository/baseBranch. |
| `apps/web/src/pages/CodeTaskNewPage.tsx:204` submit payload omits repo | `R-CHANGE` | Add repository selector. |
| `apps/web/src/services/codeAgentApi.ts:72` list has no repo filter | `R-CHANGE` | Add repository filter parameter. |
| `apps/web/src/services/codeAgentApi.ts:309`, `apps/web/src/hooks/useAskAgent.ts:118` Ask Agent prompt-only | `R-CHANGE` | Add repository context. |
| `apps/web/src/pages/MergeQueuePage.tsx:13` default owner/repo | `R-CHANGE` | Select repository or derive from connected repo context. |
| `apps/web/src/utils/issueGroups.ts:101` GitHub.com URL | `D-DISPLAY` | Keep for GitHub.com-only scope. |
| `docker/code-worker/entrypoint.sh:477` optional sync-secrets script | `R-CHANGE` | Do not execute target-repo-controlled scripts with mounted worker credentials unless the repo is trusted and the hook is explicit. |
| `docker/code-worker/entrypoint.sh:522` conditional pnpm install | `R-PARAM` | Keep as autodetect fallback; add repo-declared bootstrap. |
| `docker/code-worker/entrypoint.sh:550` writes `/repo/.claude/settings.local.json` | `R-CHANGE` | Move to ephemeral/orchestrator-owned config. |
| `firestore-collections.json:141` no connected repositories | `R-CHANGE` | Add collection ownership entry. |
| `migrations/033_code-tasks-initial-indexes.mjs:41` user/status index | `R-CHANGE` | Add repository-aware task list index. |
| `migrations/083_code-tasks-ask-agent-active-query-index.mjs:20` repo-blind Ask Agent index | `R-CHANGE` | Add repo-aware active Ask Agent index. |
| `migrations/085_deduplicate-execution-memories.mjs:13` historical IntexuraOS filter | `N-NOTE` | Do not rewrite immutable migration. |
| `.envrc.local.example:190`, `:193` single repo env examples | `R-CHANGE` | Update docs once runtime config moves to repo registry. |
| `terraform/environments/dev/main.tf:548`, `:554` single runtime repo/install secrets | `R-CHANGE` | Update runtime secret model. |
| `terraform/variables.tf:18`, `:23`, `:29` build owner/repo/branch | `M-META` | Keep as IntexuraOS build pipeline config. |
| `terraform/modules/cloud-build/main.tf:38` Cloud Build repo URI | `M-META` | Keep; not task target routing. |
| `.github/CODEOWNERS:5` IntexuraOS owner metadata | `M-META` | Keep; not copied into external repos. |
| Test fixtures with `pbuchman/intexuraos` | `T-FIXTURE` | Keep existing tests and add external-repo cases. |

---

## 11. Appendix B - Current-Code Evidence Index

Most load-bearing current references:

- Orchestrator single-repo bootstrap: `workers/orchestrator/src/bootstrap/env-config.ts:141`, `workers/orchestrator/src/start.ts:95`, `:101`, `:138`.
- Single installation ID: `workers/orchestrator/src/bootstrap/env-config.ts:146`, `workers/orchestrator/src/bootstrap/service-wiring.ts:102`, `workers/orchestrator/src/services/isolation/token-refresher.ts:7`, `:72`.
- Worktree singleton: `workers/orchestrator/src/bootstrap/service-wiring.ts:118`, `workers/orchestrator/src/services/worktree-manager.ts:23`, `:112`.
- Settings template from target repo: `workers/orchestrator/src/bootstrap/service-wiring.ts:87`, `workers/orchestrator/src/services/worktree-manager.ts:166`.
- Code task model already carries repo metadata: `apps/code-agent/src/domain/models/codeTask.ts:275`.
- Public submit default: `apps/code-agent/src/routes/code/task-routes.ts:1686`.
- Ask Agent default: `apps/code-agent/src/domain/usecases/startAskAgent.ts:87`.
- Webhook allowlist: `apps/code-agent/src/infra/github-event-parser.ts:14`, `apps/code-agent/src/domain/usecases/processGitHubWebhook.ts:132`.
- Web submit request gap: `apps/web/src/types/index.ts:1124`, `apps/web/src/pages/CodeTaskNewPage.tsx:204`.
- Firestore collection/index gap: `firestore-collections.json:141`, `migrations/033_code-tasks-initial-indexes.mjs:41`, `migrations/083_code-tasks-ask-agent-active-query-index.mjs:20`.
- Worker bootstrap nuance: `docker/code-worker/Dockerfile:50`, `docker/code-worker/entrypoint.sh:477`, `:522`, `:550`.
- Build pipeline, not task routing: `terraform/variables.tf:18`, `:23`, `:29`, `terraform/modules/cloud-build/main.tf:38`.
