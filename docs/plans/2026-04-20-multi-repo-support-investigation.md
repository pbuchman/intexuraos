# Multi-Repository Support for IntexuraOS Code Agent — Investigation & Effort Estimate

> **Status:** Investigation complete. This document is an **effort scoping** deliverable, not an executable TDD plan. It enumerates every place in the system that bakes in the assumption "the only repo we operate on is `pbuchman/intexuraos`", proposes a concrete multi-repo architecture, and produces an effort estimate the team can use to decide whether/when to build it.
>
> **Linear:** [INT-1423](https://linear.app/pbuchman/issue/INT-1423/evaluate-requirements-for-multi-repository-support-in-code-agent)

---

## 1. Executive Summary

### 1.1 What users want

Today a user creates a code task in the IntexuraOS web app and it always executes against the IntexuraOS monorepo. The user wants to point a code task at **any repository they own** (e.g. `pbuchman/some-other-project`) and have the same planning / execution / PR-review flow work end to end.

### 1.2 The shortest truthful answer

The task payload already *carries* a `repository` field, but the orchestrator is **hardcoded to clone exactly one repo at bootstrap time** and **re-uses files inside that repo** (settings template, `.claude/` skills, the worker Dockerfile) for every task it runs. So "multi-repo" is not a feature toggle — it is a **re-architecture of the orchestrator** plus parameter plumbing in the web UI, code-agent service, infra, and auth.

### 1.3 Effort estimate (engineering days, one senior full-stack engineer)

| Workstream                                                       | Effort                     | Risk   |
| ---------------------------------------------------------------- | -------------------------- | ------ |
| A. Orchestrator: per-task repo cloning & worker bootstrap        | **5–7 d**                  | High   |
| B. GitHub App: multi-installation auth (per org/repo)            | **3–5 d**                  | High   |
| C. Web UI: repo selector, filter, connect-repo flow              | **3–4 d**                  | Medium |
| D. Code-agent service: accept `repository` at submit, routing    | **2–3 d**                  | Low    |
| E. Firestore: indexes, access control per repo                   | **1–2 d**                  | Low    |
| F. Worker runtime: decouple from monorepo file layout            | **2–3 d**                  | Medium |
| G. Infra/Terraform: GitHub App & Cloud Build re-parameterization | **2 d**                    | Medium |
| H. User onboarding: "install the GitHub App on X" flow           | **2–3 d**                  | Medium |
| I. Docs, e2e testing, rollout to a pilot external repo           | **2 d**                    | Low    |
| **Total**                                                        | **22–31 engineering days** |        |

**Calendar estimate:** 5–7 weeks with one engineer, ~3 weeks with two engineers in parallel (split A+B+G from C+D+H). A meaningful private-preview (single extra repo, same org, same GitHub App install) is achievable in **~2 weeks** by cutting scope B, G, H down to "reuse existing installation".

### 1.4 Minimum-viable private preview (MVP) vs full product

Two separable milestones emerged from the investigation:

- **MVP (≈2 weeks, one engineer):** Same GitHub org, same GitHub App installation, the orchestrator is redeployed per repo (or one orchestrator per repo). This proves the architecture and unlocks internal repos. Skips B, G, H.
- **Full product (~5–7 weeks):** One orchestrator fleet serves any repo any user connects; users install the IntexuraOS GitHub App on their own repos from the web UI; the web UI has a first-class repo picker.

---

## 2. Current Architecture — Single-Repo Assumptions

### 2.1 Orchestrator worker (`workers/orchestrator/`) — the heart of the problem

The orchestrator is a long-running process that accepts task dispatches over HTTP, clones a git repo, creates worktrees, and spawns Docker containers running the Claude worker. **It binds to one repo at startup:**

| File                                                             | Line          | What is hardcoded-at-bootstrap                                                                                                                             |
| ---------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/start.ts`                              | 442           | `const repoUrl = getRequiredEnv('INTEXURAOS_REPOSITORY_URL');` — single URL read once per process                                                          |
| `workers/orchestrator/src/start.ts`                              | 443           | `repoPath` is a single directory; all worktrees branch from it                                                                                             |
| `workers/orchestrator/src/start.ts`                              | 539           | `await ensureRepository(repoUrl, repoPath, logger);` — one clone, once                                                                                     |
| `workers/orchestrator/src/start.ts`                              | 456           | `const githubInstallationId = getRequiredEnv('INTEXURAOS_GITHUB_APP_INSTALLATION_ID');` — one installation                                                 |
| `workers/orchestrator/src/start.ts`                              | 544–549       | `GitHubTokenService` constructed once with that one installation ID                                                                                        |
| `workers/orchestrator/src/start.ts`                              | 560–573       | `WorktreeManager` gets a single `repositoryPath` and a `settingsLocalTemplatePath` **inside** that repo                                                    |
| `workers/orchestrator/src/start.ts`                              | 564–569       | `settingsLocalTemplatePath = join(repoPath, 'workers', 'code-worker', 'config-defaults', 'settings.local.json')` — assumes the target repo *is* IntexuraOS |
| `workers/orchestrator/src/services/worktree-manager.ts`          | 86–88         | `git fetch origin "${baseBranch}"` — assumes the `origin` remote is the one we want                                                                        |
| `workers/orchestrator/src/services/repo-manager.ts`              | 131           | `cloneRepository` is only called from the bootstrap path                                                                                                   |
| `workers/orchestrator/src/services/isolation/token-refresher.ts` | 7–13, 37, 114 | Minted token written to a **single** `/secrets/github-token`, refreshed every 30 min                                                                       |

**Implication:** adding a repo today requires spinning up another orchestrator deployment, another GitHub App installation ID env var, and another repo clone path. You cannot run "task A against repo 1 and task B against repo 2" in the same orchestrator process.

### 2.2 Code-agent service (`apps/code-agent/`)

The code-agent is the Fastify app the web UI POSTs to. It *already* stores `repository` on the task, but treats it as metadata:

| File                                                           | Line                                           | Observation                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/model/codeTask.ts`                 | 189                                            | `repository: string` (e.g. `"pbuchman/intexuraos"`) — stored on the task                                   |
| `apps/code-agent/src/domain/model/codeTask.ts`                 | ~190                                           | `baseBranch: string` — stored on the task                                                                  |
| `apps/code-agent/src/domain/services/gitHubDispatchService.ts` | 113–122                                        | `if (owner === 'intexuraos') return senderLogin;` — **hardcoded org name** in fork-detection logic         |
| `apps/code-agent/src/domain/services/gitHubDispatchService.ts` | 246                                            | `` `https://github.com/${event.repository}/pull/${...}` `` — hardcodes `github.com` (no GitHub Enterprise) |
| Multiple tests                                                 | e.g. `automationCommentRenderer.test.ts:52,57` | Fixtures hardcode `https://github.com/pbuchman/intexuraos/pull/42`                                         |

**Implication:** the service can *carry* a different repo identifier, but (a) it will route everything to the same orchestrator, and (b) the fork-detection branch breaks for any org other than `intexuraos`.

### 2.3 Web app (`apps/web/`) — no repo concept at all in the user flow

| File                                      | Line      | Observation                                                                                     |
| ----------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `apps/web/src/pages/CodeTaskNewPage.tsx`  | full file | **No repository selector.** The form has: prompt, worker type, task mode, Linear issue. Period. |
| `apps/web/src/types/index.ts`             | 1040–1045 | `SubmitCodeTaskRequest` has no `repository` field                                               |
| `apps/web/src/types/index.ts`             | 987–1029  | `CodeTask.repository` exists on the response type only                                          |
| `apps/web/src/services/codeAgentApi.ts`   | 85        | `POST /code/submit` — backend decides the repo                                                  |
| `apps/web/src/utils/issueGroups.ts`       | 110       | PR link built from `task.repository` — already flexible                                         |
| `apps/web/src/pages/CodeTasksPage.tsx`    | 95–96     | Task grouping keyed by `linearIssueId`, not repo — no per-repo filter UI                        |
| `apps/web/src/pages/CodeTaskViewPage.tsx` | 62        | `https://github.com/${task.repository}/pull/${prNumber}` — already flexible                     |

**Implication:** users cannot pick a repo. List views don't filter or group by repo. All PR links already use the `repository` field, so display-side is 80% ready; input-side is 0% ready.

### 2.4 Worker runtime (`docker/code-worker/`)

The worker Docker image is fairly repo-agnostic, but has a few monorepo-specific crutches:

| File                                | Line               | Observation                                                                                                                                    |
| ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker/code-worker/Dockerfile`    | 40–41              | Custom `gh` wrapper reads `/secrets/github-token` at each call — **auth is fine for any repo** if the token has scope                          |
| `docker/code-worker/Dockerfile`    | 50–51              | `pnpm install --frozen-lockfile` is unconditionally executed — **fails on non-pnpm repos**                                                     |
| `docker/code-worker/Dockerfile`    | 62–66              | Claude CLI installed globally — portable                                                                                                       |
| `docker/code-worker/Dockerfile`    | 76                 | `git clone https://github.com/obra/superpowers.git` at build — portable                                                                        |
| `docker/code-worker/entrypoint.sh` | 47                 | Sets git credential helper — portable                                                                                                          |
| `docker/code-worker/entrypoint.sh` | 125–131            | `cd /repo` and runs in place — portable                                                                                                        |
| Orchestrator-side settings template | `start.ts:564–569` | Copies `docker/code-worker/config-defaults/settings.local.json` **from the target repo** — **breaks on any repo that doesn't ship this file** |

**Implication:** the worker is closer to portable than the orchestrator, but the settings template must move out of the target repo, and any "pnpm bootstrap" step must become optional or repo-declared.

### 2.5 GitHub authentication

IntexuraOS uses a **GitHub App** (not a PAT). The App mints installation tokens (lifetime ~1h, refreshed every 30 min) via `workers/orchestrator/src/services/isolation/token-refresher.ts`. Critical facts:

- The App has **one installation ID per org/user** it is installed on. A single installation can cover many repos in the same org, but a different org needs a different install.
- Installation ID is taken from env (`INTEXURAOS_GITHUB_APP_INSTALLATION_ID`) — **one per orchestrator process**.
- User-facing OAuth (`apps/user-service/src/infra/github/gitHubOAuthClient.ts:19`) uses scopes `['repo', 'read:user']` — this is only for user identity, *not* for the worker's git operations.
- The App's private key is stored in GCP Secret Manager as `INTEXURAOS_GITHUB_APP_PRIVATE_KEY`.

**Implication:** supporting other orgs requires a registry of installation IDs (one per (org, user) pair) and a flow where users install the IntexuraOS GitHub App on their repos from the web UI.

### 2.6 Infrastructure (Terraform)

| File                                    | Line  | Observation                                                                                                                                                 |
| --------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terraform/environments/dev/main.tf`    | 56–76 | `github_owner`, `github_repo`, `github_branch` are variables (default `intexuraos`/`development`) — already parameterized for the **build/deploy** pipeline |
| `terraform/modules/cloud-build/main.tf` | 36–38 | Cloud Build repository is parameterized by owner/repo                                                                                                       |
| `.github/CODEOWNERS`                    | 5, 8  | Hardcoded `@pbuchman` — not a runtime concern but will leak into PRs opened on external repos                                                               |

**Implication:** Cloud Build and Terraform are mostly parameterized already, because they are about **building IntexuraOS itself**, not about running code tasks.

### 2.7 Firestore

| File                                 | Fact                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firestore-collections.json:137–141` | `code_tasks` is a flat collection, owner = `code-agent`. Each task already has a `repository` field. No compound index on `(userId, repository, status)` today. |
| `CodeTask` model                     | `repository: string` present. No `repositoryInstallationId`. No per-repo access-control scope.                                                                  |

**Implication:** a single new compound index + an optional filter at query time covers the backend list path. Access control (can user X see repo Y's tasks?) needs a new rule.

### 2.8 `.claude/` and `CLAUDE.md`

The worker reads its behavioral config from `.claude/` inside the mounted repo. A non-IntexuraOS repo will have **no `.claude/CLAUDE.md`**, no project-specific skills, no per-repo hooks. The worker must degrade gracefully when these are absent. Also: `CLAUDE.md` hard-codes `dev.intexuraos.cloud` / `intexuraos.cloud` URLs in the `Code Task Investigation` section (lines 62–64) — fine for IntexuraOS's own repo, but leaks IntexuraOS's domains into anyone else's `.claude/` if we ever propose bootstrapping one there.

---

## 3. Target Architecture — Per-Task Repo

The cleanest design: **the orchestrator becomes repo-agnostic; every task dispatch carries its own `(repository, baseBranch, installationId)` triple.** The orchestrator maintains a **cache** of clones keyed by repo URL, and a **cache** of installation tokens keyed by installation ID.

```
User (web)
  └─ POST /code/submit { prompt, repository, baseBranch, workerType, ... }
      └─ code-agent persists CodeTask { repository, baseBranch, installationId, ... }
          └─ dispatch to orchestrator: { taskId, repoUrl, baseBranch, installationId, ... }
              └─ orchestrator:
                  1. ensure local clone of repoUrl exists (cache it)
                  2. fetch baseBranch on that clone
                  3. mint token for installationId, write to per-task /secrets/github-token
                  4. create worktree, mount into Docker worker
                  5. worker runs, opens PR via gh using that token
```

Key design decisions surfaced by the investigation:

1. **Repo clone cache** — one directory per `(owner, repo)` under `~/.code-orchestrator/repos/<owner>__<repo>/`. The orchestrator lazily clones on first task for a repo, and runs `git fetch` before every worktree. (Per-task fresh clones would be simpler but 10–60× slower on any non-trivial repo.)
2. **Settings template** — move `docker/code-worker/config-defaults/settings.local.json` out of the IntexuraOS repo and into the orchestrator's own code (`workers/orchestrator/config-defaults/`). The template is about the worker runtime, not about IntexuraOS. This is a **one-time breaking change** to the current bootstrap.
3. **Installation token cache** — `GitHubTokenService` becomes `GitHubTokenPool` keyed by installation ID, each entry refreshed independently on its ~55-min schedule.
4. **Per-task secrets path** — instead of a single `/secrets/github-token`, the orchestrator writes `~/.code-orchestrator/secrets/<taskId>/github-token` and bind-mounts that path into the worker. (Already half-true today; needs generalization.)
5. **Base-branch normalization** — `WorktreeManager` must stop assuming `development`. It does already accept `baseBranch` as a parameter; the test fixture at `worktree-manager.test.ts:125` is the only place it's hardcoded. Real fix: the code-agent stores the repo's default branch at connect-time and supplies it per task.
6. **Fork-detection** — `gitHubDispatchService.ts:113–122` has a literal `'intexuraos'` comparison. Replace with a per-repo "primary owner" stored alongside the repo connection record.
7. **Worker degradation** — the worker must handle the absence of `package.json`, `pnpm-lock.yaml`, `.claude/`. Treat all "IntexuraOS-isms" (auto-`pnpm install`, auto-`pnpm run ci:tracked`) as **opt-in hooks declared by the target repo's `.intexuraos/config.yaml`** (new file) rather than unconditional steps.

---

## 4. Change Inventory — Every File That Must Move

### 4.1 Backend — orchestrator

**Primary changes (must-do for MVP):**

- `workers/orchestrator/src/start.ts:442–443,539,560–573` — Drop `INTEXURAOS_REPOSITORY_URL` / `INTEXURAOS_REPOSITORY_PATH` as required bootstrap. Initialize `WorktreeManager` with a `reposBasePath` (`~/.code-orchestrator/repos/`) instead of a single `repositoryPath`.
- `workers/orchestrator/src/services/repo-manager.ts` — New public method: `ensureRepositoryCached(repoUrl): Promise<string>` that clones on first call, `git fetch` on subsequent. Returns the on-disk path.
- `workers/orchestrator/src/services/worktree-manager.ts:86–88` — Take `repositoryPath` per-call instead of per-instance. Signature change: `createWorktree({ repoUrl, baseBranch, taskId }) → Promise<string>`.
- `workers/orchestrator/src/services/isolation/token-refresher.ts` — Introduce `GitHubTokenPool`; key by `installationId`; each installation gets its own refresh timer and its own on-disk token file.
- `workers/orchestrator/src/github/token-service.ts` — Already parameterized by installation ID, but called only from singleton. Wire the pool to dispatch.
- `workers/orchestrator/src/api/dispatch.ts` (or equivalent HTTP handler) — Accept `repoUrl`, `baseBranch`, `installationId` in the dispatch payload. Thread them through to `WorktreeManager`/`TokenPool`.
- `workers/orchestrator/config-defaults/settings.local.json` — **New file.** Moved out of the IntexuraOS repo. Shipped with the orchestrator itself.

**Secondary (pre-full-product):**

- Capacity accounting (`INTEXURAOS_WORKER_CAPACITY`) — currently a single integer. For multi-repo, consider per-repo or per-installation concurrency limits (optional).

### 4.2 Backend — code-agent service

- `apps/code-agent/src/domain/model/codeTask.ts:189` — Keep `repository`. Add `installationId: string`, `defaultBranch: string`.
- New domain object: `ConnectedRepository { id, owner, repo, installationId, defaultBranch, connectedByUserId, connectedAt }`.
- New use case: `connectRepositoryUseCase` — called from a new web endpoint when the user finishes the GitHub App install flow.
- New use case: `listConnectedRepositoriesUseCase` — returns repos available to the current user for the web picker.
- `apps/code-agent/src/domain/services/gitHubDispatchService.ts:113–122` — Replace the literal `'intexuraos'` with a lookup against `ConnectedRepository.primaryOwner`.
- `apps/code-agent/src/routes/submit.ts` (or wherever `POST /code/submit` lives) — Accept `repository` in the body, validate the user has access to that connected repo, set `installationId` from the connection record.
- New routes: `GET /code/repositories`, `POST /code/repositories/connect/callback` (GitHub App install callback), `DELETE /code/repositories/:id`.
- `firestore-collections.json` — New collection owner entry: `connected_repositories` owned by `code-agent`.

### 4.3 Backend — dispatch payload contract

The internal HTTP contract between `code-agent` and `orchestrator` changes. New request shape:

```ts
interface DispatchTaskRequest {
  taskId: string;
  prompt: string;
  workerType: CodeTaskWorkerType;
  // NEW:
  repoUrl: string;        // "https://github.com/<owner>/<repo>.git"
  baseBranch: string;
  installationId: string;
}
```

This must be versioned (simple: accept old shape for one release, default `repoUrl` to the legacy env var; log a deprecation warning).

### 4.4 Web app

- `apps/web/src/pages/CodeTaskNewPage.tsx` — Add a **repository selector** above the prompt. Driven by `GET /code/repositories`. Default to "most recently used" per user.
- `apps/web/src/types/index.ts:1040–1045` — Add `repository: string` to `SubmitCodeTaskRequest`.
- `apps/web/src/services/codeAgentApi.ts` — Extend the submit client; add `listRepositories`, `connectRepositoryCallback`, `disconnectRepository`.
- `apps/web/src/pages/CodeTasksPage.tsx` — Add a "repo" filter chip, a "group by repo" toggle. Probably also a per-repo tab shell.
- `apps/web/src/pages/SettingsRepositoriesPage.tsx` — **New page.** Lists connected repos; has an "Install IntexuraOS on a new repo" button that redirects to the GitHub App install URL and back.
- `apps/web/src/config.ts` — If a new backend URL is introduced for the install callback, follow the three-location rule (`getConfig()`, `cloudbuild.yaml` `CLOUD_RUN_SERVICES`, `vite.config.ts` proxy). **No new URL needed** if we stay inside the existing `code-agent` service — recommended.
- `apps/web/src/utils/issueGroups.ts:110` — Already correct (uses `task.repository`).
- `apps/web/src/pages/CodeTaskViewPage.tsx:62` — Already correct (uses `task.repository`).

### 4.5 Worker runtime

- `docker/code-worker/Dockerfile:50–51` — Remove the hardcoded `pnpm install`. Instead, let the worker entrypoint read a repo-declared bootstrap command from `.intexuraos/config.yaml` (or fall back to "auto-detect from lockfile").
- `docker/code-worker/entrypoint.sh` — Add a `setup_repo` step that:
  - reads `.intexuraos/config.yaml` if present,
  - detects `package.json` / `pnpm-lock.yaml` / `requirements.txt` / `go.mod` and runs the corresponding install,
  - no-ops if none of the above match (a plain docs-only repo should just work).
- New file: `workers/orchestrator/config-defaults/settings.local.json` (moved from `docker/code-worker/config-defaults/settings.local.json`). Old location can be left as a courtesy copy for the IntexuraOS repo itself.

### 4.6 Infrastructure

- `terraform/modules/github-app/` — **New module** (or new resource inside an existing module) that encodes the IntexuraOS GitHub App and its installation callback URL. Today the App is managed manually via the GCP Console; documenting and parameterizing it is worth 1–2 days.
- `terraform/environments/dev/main.tf` — No change to the build variables (`github_owner`/`github_repo` are about building IntexuraOS itself, not about runtime tasks).
- GCP Secret Manager — `INTEXURAOS_GITHUB_APP_PRIVATE_KEY` already stored. No change.

### 4.7 Firestore

- New collection: `connected_repositories` — `{ id, userId, owner, repo, installationId, defaultBranch, connectedAt }`.
- New index: `code_tasks` on `(userId, repository, status, updatedAt DESC)` to support the repo-filtered list view. Add to `migrations/*.mjs`.
- Security rules — a user can only read `code_tasks` where `userId == auth.uid` (unchanged); they can only *create* a task against a `repository` whose connection record they own.

### 4.8 Cross-cutting

- Tests referencing `pbuchman/intexuraos` literally — keep them (they represent the current-user's own repo), but add a second set of fixtures for e.g. `pbuchman/sample-external`.
- Docs — update `docs/overview.md`, add `docs/multi-repo.md`, and extend `create-service` / `debug-code-task` skill docs to show the repo parameter.

---

## 5. User Experience Changes

### 5.1 First-run: connect a repo

1. User opens `Settings → Repositories` (new page).
2. Clicks **Connect a repository**.
3. Redirected to `https://github.com/apps/intexuraos/installations/new` with a state param carrying the user's ID.
4. User picks the target repo(s) on GitHub, accepts the permissions.
5. GitHub redirects back to `/#/settings/repositories?installation_id=...&setup_action=install`.
6. Web app calls `POST /code/repositories/connect/callback` with the `installation_id`; code-agent fetches repo metadata via the App API, persists a `ConnectedRepository` per repo.
7. The page now lists the newly connected repos. They become selectable in the task-creation form.

### 5.2 Creating a task

- `CodeTaskNewPage` grows one new control at the top: **Repository** (searchable dropdown, typeahead across connected repos). Default = last used; persisted in `localStorage`.
- The rest of the form is unchanged.

### 5.3 Listing tasks

- `CodeTasksPage` grows a **Repository** filter chip (multi-select).
- Task cards gain a compact repo badge (`pbuchman/foo`) next to the Linear ID.
- Default view: current user's recently-active repos, all statuses, newest first.

### 5.4 Task detail / PR links

- No change required. All GitHub URLs are already constructed from `task.repository`.

### 5.5 Removing a repo

- From `Settings → Repositories`, a **Disconnect** button removes the `ConnectedRepository` (keeps historical tasks intact) and optionally revokes the App installation via a deep link to GitHub.

---

## 6. Risks & Open Questions

| #   | Risk                                                                                                                                                                                  | Mitigation                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | The orchestrator today caches an 800 MB IntexuraOS clone; caching 10 repos × that size is ~8 GB. Disk growth on the `home-dev` host is a real concern.                                | Add a size-capped LRU on the clone cache; document the operational cap.                                             |
| 2   | A malicious user connects a repo they don't really own (GitHub App installs are per-org, not per-user).                                                                               | On callback, verify the user is an admin/member of the target org via GitHub's API. Reject otherwise.               |
| 3   | The worker's `pnpm install` being unconditional today means a repo without a `package.json` fails loudly.                                                                             | Repo-declared bootstrap (`.intexuraos/config.yaml`) with sensible auto-detection fallback.                          |
| 4   | `.github/CODEOWNERS` hardcoded to `@pbuchman` leaks into any PR the worker opens against a different repo.                                                                            | Don't write CODEOWNERS — that's the target repo's own file. Verify the worker only edits files in the task's scope. |
| 5   | Concurrency — can two tasks run against the same repo at once? Worktree isolation already handles this, but `git fetch` on a shared clone is not atomic.                              | Add a per-repo mutex in `RepoManager` wrapping the `git fetch` step.                                                |
| 6   | GitHub Enterprise / self-hosted — `github.com` is hardcoded in PR URL construction (`gitHubDispatchService.ts:246`) and in the install URL.                                           | Out of scope for MVP. Document as future work.                                                                      |
| 7   | `.claude/CLAUDE.md` behavior — the worker behaves quite differently with and without it. A user connecting a repo without `.claude/` may be surprised by the worker's output quality. | Document clearly; consider an in-app "install a starter `.claude/` skeleton" action.                                |
| 8   | Linear integration is today global for the IntexuraOS team. External repos may want a different Linear workspace, or none.                                                            | Extend `ConnectedRepository` with an optional `linearTeamId`; default to the user's team.                           |
| 9   | Billing/usage — today we treat all tasks as one usage bucket. Per-repo or per-org accounting may be needed.                                                                           | Add `repository` to usage events (`INTEXURAOS_USAGE_WEBHOOK_URL` payload). Low-effort.                              |

---

## 7. Rollout Plan (recommended)

1. **Week 1** — Land the orchestrator changes behind a feature flag (`INTEXURAOS_MULTI_REPO=1`). When off, behavior is identical to today. Land the `connected_repositories` collection and the new Firestore index.
2. **Week 2** — Land the web UI: repo selector (dropdown of one — the IntexuraOS repo — when flag off), filter, settings page. Ship to dev. Verify IntexuraOS-against-itself still works end to end.
3. **Week 3** — Enable the flag on dev. Connect one pilot external repo owned by the same user. Run 5 representative tasks (planning, execution, PR review, retry, archive).
4. **Week 4** — Address pilot feedback. Add the worker-bootstrap fallbacks. Update docs. Pilot a second repo in a *different* org to exercise the installation-pool code path.
5. **Week 5** — Production rollout. Keep the flag, but default on.

---

## 8. Non-Goals (explicitly)

- **Self-hosted GitHub / GitHub Enterprise.** Out of scope. `github.com` assumption stays.
- **Non-GitHub providers (GitLab, Bitbucket).** Out of scope.
- **Public repos with read-only access / anonymous task submission.** Out of scope; authentication flow unchanged.
- **Per-repo worker images.** The worker image stays the shared `code-worker:latest`. Repos customize via `.intexuraos/config.yaml`, not via a fork of the Dockerfile.
- **Multi-tenant isolation across users** within the same orchestrator process — deferred. Today all users share capacity; that stays true.

---

## 9. Appendix — Evidence Index

Every claim above is traceable to a specific file:line inspected during the investigation. The most load-bearing references:

- Orchestrator single-repo bootstrap: `workers/orchestrator/src/start.ts:442,539,564–569`
- Single installation ID: `workers/orchestrator/src/start.ts:456`, `token-refresher.ts:7–13,37,114`
- Hardcoded org in fork logic: `apps/code-agent/src/domain/services/gitHubDispatchService.ts:113–122`
- Hardcoded github.com: `apps/code-agent/src/domain/services/gitHubDispatchService.ts:246`
- Web submit request has no `repository`: `apps/web/src/types/index.ts:1040–1045`
- Web new-task page has no selector: `apps/web/src/pages/CodeTaskNewPage.tsx` (full)
- Task model already carries `repository`: `apps/code-agent/src/domain/model/codeTask.ts:189`
- Flat Firestore collection: `firestore-collections.json:137–141`
- Worker bootstrap assumes pnpm: `docker/code-worker/Dockerfile:50–51`
- Terraform is parameterized: `terraform/environments/dev/main.tf:56–76`
- CODEOWNERS hardcoded: `.github/CODEOWNERS:5,8`
