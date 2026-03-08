# GitHub OAuth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace static `INTEXURAOS_GITHUB_API_TOKEN` with per-user GitHub OAuth tokens via user-service, and remove all `githubUsername` legacy code from code-agent/web.

**Architecture:** Mirrors the Google Calendar OAuth pattern exactly. user-service owns GitHub OAuth (port, infra client, routes, internal endpoints). code-agent consumes tokens via `UserServiceClient` from `packages/internal-clients`. Web app gets a new `GitHubConnectionPage` and removes the manual `githubUsername` field.

**Tech Stack:** TypeScript, Fastify, Firestore (encrypted tokens), native fetch, nock (test HTTP mocking), React (web app)

**Design Doc:** `docs/plans/2026-03-02-github-oauth-design.md`

---

## Parallel Workstream Architecture

Five independent workstreams that can execute in parallel, plus two sequential gates.

```
                    ┌─────────────────┐
                    │  Gate 0: Build  │
                    │   pnpm build    │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┬───────────────────┐
        ▼                    ▼                    ▼                   ▼
┌───────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌────────────────┐
│ Stream A      │  │ Stream B         │  │ Stream C     │  │ Stream D       │
│ user-service  │  │ internal-clients │  │ code-agent   │  │ web app        │
│ GitHub OAuth  │  │ + cleanup infra  │  │ cleanup +    │  │ GitHub page +  │
│               │  │                  │  │ rewire       │  │ cleanup        │
│ Model: sonnet │  │ Model: sonnet    │  │ Model: opus  │  │ Model: sonnet  │
└───────┬───────┘  └────────┬─────────┘  └──────┬───────┘  └────────┬───────┘
        │                   │                    │                   │
        └───────────────────┼────────────────────┼───────────────────┘
                            ▼                    │
                    ┌────────────────┐           │
                    │ Stream E       │           │
                    │ Firestore      │           │
                    │ migration      │           │
                    │ Model: haiku   │           │
                    └────────┬───────┘           │
                             │                   │
                             ▼                   ▼
                    ┌─────────────────────────────────┐
                    │  Gate 1: Integration            │
                    │  Merge all streams + CI         │
                    │  Model: opus (main session)     │
                    └────────┬────────────────────────┘
                             ▼
                    ┌─────────────────────────────────┐
                    │  Gate 2: Verification           │
                    │  Code review + consistency +    │
                    │  regression + UX verification   │
                    │  Model: opus (review agents)    │
                    └─────────────────────────────────┘
```

---

## Gate 0: Build Packages (main session, before dispatching agents)

```bash
pnpm build
```

Verify all packages built before spawning workstreams.

---

## Stream A: user-service — GitHub OAuth Provider [Model: sonnet, isolation: worktree]

### Task A1: GitHubOAuthClient Port

**Files:**
- Create: `apps/user-service/src/domain/oauth/ports/GitHubOAuthClient.ts`

**Step 1: Create the port interface**

Mirror `GoogleOAuthClient` but without `refreshAccessToken` (GitHub tokens don't expire).

```typescript
/**
 * Port for GitHub OAuth operations.
 * Unlike Google, GitHub OAuth App tokens do not expire, so no refresh method.
 */

import type { Result } from '@intexuraos/common-core';
import type { OAuthError } from '../models/OAuthError.js';

export interface GitHubTokenResponse {
  accessToken: string;
  tokenType: string;
  scope: string;
}

export interface GitHubUserInfo {
  username: string;
  email: string | null;
}

export interface GitHubOAuthClient {
  generateAuthUrl(state: string, redirectUri: string): string;

  exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<Result<GitHubTokenResponse, OAuthError>>;

  getUserInfo(accessToken: string): Promise<Result<GitHubUserInfo, OAuthError>>;

  revokeToken(accessToken: string): Promise<Result<void, OAuthError>>;
}
```

**Step 2: Export from barrel**

Modify: `apps/user-service/src/domain/oauth/index.ts` — add exports for `GitHubOAuthClient`, `GitHubTokenResponse`, `GitHubUserInfo`.

**Step 3: Add `GITHUB` to `OAuthProviders`**

Modify: `apps/user-service/src/domain/oauth/models/OAuthConnection.ts`

```typescript
export const OAuthProviders = {
  GOOGLE: 'google',
  GITHUB: 'github',
} as const;
```

---

### Task A2: GitHubOAuthClient Implementation

**Files:**
- Create: `apps/user-service/src/infra/github/gitHubOAuthClient.ts`
- Create: `apps/user-service/src/infra/github/index.ts`
- Test: `apps/user-service/src/__tests__/infra/gitHubOAuthClient.test.ts`

**Step 1: Write failing tests**

Write nock-based tests mirroring `apps/user-service/src/__tests__/infra/googleOAuthClient.test.ts`:
- `generateAuthUrl` returns correct GitHub URL with `client_id`, `redirect_uri`, `scope=repo read:user`, `state`
- `exchangeCode` success: POST to `https://github.com/login/oauth/access_token` with `Accept: application/json`, returns `{ access_token, token_type, scope }`
- `exchangeCode` failure: non-ok response returns `TOKEN_EXCHANGE_FAILED` error
- `getUserInfo` success: GET `https://api.github.com/user` with Bearer token, returns `{ login, email }`
- `getUserInfo` failure: returns `INTERNAL_ERROR`
- `revokeToken` success: DELETE `https://api.github.com/applications/{client_id}/grant` with Basic auth
- `revokeToken` failure: non-ok response returns error

**Step 2: Run tests, confirm they fail**

```bash
pnpm run verify:workspace:tracked user-service
```

**Step 3: Implement `GitHubOAuthClientImpl`**

Mirror `GoogleOAuthClientImpl` structure. Key GitHub-specific details:
- Auth URL: `https://github.com/login/oauth/authorize`
- Token URL: `https://github.com/login/oauth/access_token` (must send `Accept: application/json`)
- User URL: `https://api.github.com/user`
- Revoke URL: `https://api.github.com/applications/{client_id}/grant` (Basic auth with `client_id:client_secret`)
- Scopes: `repo read:user`

```typescript
export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class GitHubOAuthClientImpl implements GitHubOAuthClient { ... }
```

Barrel export: `apps/user-service/src/infra/github/index.ts`

**Step 4: Run tests, confirm they pass**

```bash
pnpm run verify:workspace:tracked user-service
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(user-service): add GitHubOAuthClient port and implementation"
```

---

### Task A3: Wire GitHub OAuth into ServiceContainer

**Files:**
- Modify: `apps/user-service/src/services.ts`
- Modify: `apps/user-service/src/index.ts`

**Step 1: Add `gitHubOAuthClient` to `ServiceContainer`**

```typescript
export interface ServiceContainer {
  // ... existing
  gitHubOAuthClient: GitHubOAuthClient | null;
}
```

**Step 2: Add `loadGitHubOAuthClient()` function** (mirrors `loadGoogleOAuthClient`)

```typescript
function loadGitHubOAuthClient(): GitHubOAuthClient | null {
  const clientId = process.env['INTEXURAOS_GITHUB_OAUTH_CLIENT_ID'];
  const clientSecret = process.env['INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET'];
  if (clientId === undefined || clientId === '' || clientSecret === undefined || clientSecret === '') {
    return null;
  }
  return new GitHubOAuthClientImpl({ clientId, clientSecret });
}
```

**Step 3: Add to `initializeServices()`** container initialization.

**Step 4: Add env vars to `REQUIRED_ENV` in `index.ts`** — NO. These are optional (like Google OAuth was before being required). The `null` check in routes handles it.

Actually, check: Google OAuth client/secret ARE in `REQUIRED_ENV` in user-service. Follow the same pattern — add `INTEXURAOS_GITHUB_OAUTH_CLIENT_ID` and `INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET` to `REQUIRED_ENV`.

**Step 5: Update ALL `setServices()` calls in tests** — add `gitHubOAuthClient: null` to every test that calls `setServices()`.

Search: `grep -r "setServices(" apps/user-service/src/__tests__/` — update all.

**Step 6: Run tests, confirm pass**

```bash
pnpm run verify:workspace:tracked user-service
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat(user-service): wire GitHubOAuthClient into ServiceContainer"
```

---

### Task A4: GitHub OAuth Connection Routes

**Files:**
- Create: `apps/user-service/src/routes/gitHubOAuthConnectionRoutes.ts`
- Test: `apps/user-service/src/__tests__/gitHubOAuthConnectionRoutes.test.ts`
- Modify: `apps/user-service/src/routes/index.ts` (register new routes)

**Step 1: Write failing tests**

Mirror `apps/user-service/src/__tests__/oauthConnectionRoutes.test.ts` structure:

- `POST /oauth/connections/github/initiate` — returns `{ authorizationUrl }` with correct GitHub URL
- `POST /oauth/connections/github/initiate` — returns 503 when `gitHubOAuthClient` is null
- `GET /oauth/connections/github/callback` — success: exchanges code, saves connection, redirects to `/#/settings/github?oauth_success=true`
- `GET /oauth/connections/github/callback` — error param redirects with error
- `GET /oauth/connections/github/callback` — expired state returns error redirect
- `GET /oauth/connections/github/status` — connected: returns `{ connected: true, username, scopes }`
- `GET /oauth/connections/github/status` — not connected: returns `{ connected: false }`
- `DELETE /oauth/connections/github` — disconnects and returns success

Key differences from Google:
- Callback redirects to `/#/settings/github` (not `/#/settings/calendar`)
- Status response includes `username` field (GitHub username from `email` column — see design note)
- The `initiateOAuthFlow` use case is provider-agnostic and reused as-is
- The `exchangeOAuthCode` use case needs a provider-aware version OR a GitHub-specific version

**Important design note:** The existing `exchangeOAuthCode` use case calls `googleOAuthClient.exchangeCode()` and `googleOAuthClient.getUserInfo()` directly. For GitHub, create a new `exchangeGitHubOAuthCode` use case that calls `gitHubOAuthClient.exchangeCode()` and `gitHubOAuthClient.getUserInfo()`. Store the GitHub `username` in the `email` field of `OAuthConnection` (reusing the existing schema). The `getValidAccessToken` use case already returns `{ accessToken, email }` — for GitHub, `email` will contain the username.

Alternatively, rename `email` to be more generic. But that's a bigger change. Store username in email field for now — it's the user identifier per provider.

**Step 2: Implement routes** mirroring `oauthConnectionRoutes.ts`. Use `gitHubOAuthClient` from `getServices()`.

**Step 3: Create `exchangeGitHubOAuthCode` use case**

File: `apps/user-service/src/domain/oauth/usecases/exchangeGitHubOAuthCode.ts`

Mirror `exchangeOAuthCode.ts` but call `gitHubOAuthClient` methods. Store `userInfo.username` as the `email` field in `saveConnection`.

Export from `apps/user-service/src/domain/oauth/usecases/index.ts` and `apps/user-service/src/domain/oauth/index.ts`.

**Step 4: Create GitHub-aware `disconnectGitHubProvider` use case**

File: `apps/user-service/src/domain/oauth/usecases/disconnectGitHubProvider.ts`

Mirror `disconnectProvider.ts` but call `gitHubOAuthClient.revokeToken()`.

**Step 5: Adapt `getValidAccessToken` for GitHub**

Currently `getValidAccessToken` refreshes expired tokens. For GitHub, tokens don't expire. Options:
- Make it work as-is (check expiry, token won't be expired, return immediately). Set `expiresAt` far in the future (e.g., `9999-12-31T00:00:00.000Z`) when saving the GitHub connection.
- This means `getValidAccessToken` works without changes for GitHub — the expiry check always passes.

**Step 6: Register routes in `apps/user-service/src/routes/index.ts`**

```typescript
import { gitHubOAuthConnectionRoutes } from './gitHubOAuthConnectionRoutes.js';
// In authRoutes:
fastify.register(gitHubOAuthConnectionRoutes);
```

**Step 7: Run tests, confirm pass**

```bash
pnpm run verify:workspace:tracked user-service
```

**Step 8: Commit**

```bash
git add -A && git commit -m "feat(user-service): add GitHub OAuth connection routes and use cases"
```

---

### Task A5: Internal Endpoint — GitHub Token + Username Lookup

**Files:**
- Modify: `apps/user-service/src/routes/internalRoutes.ts`
- Modify: `apps/user-service/src/domain/oauth/ports/OAuthConnectionRepository.ts`
- Modify: `apps/user-service/src/infra/firestore/oauthConnectionRepository.ts`
- Test: existing internal routes test file + new repository tests

**Step 1: Add `findByProviderEmail` to `OAuthConnectionRepository` port**

```typescript
findByProviderEmail(
  provider: OAuthProvider,
  email: string
): Promise<Result<OAuthConnection | null, OAuthError>>;
```

This queries `oauth_connections` where `provider == 'github'` and `email == username`.

**Step 2: Implement in Firestore repository**

```typescript
async findByProviderEmail(
  provider: OAuthProvider,
  email: string
): Promise<Result<OAuthConnection | null, OAuthError>> {
  const db = getFirestore();
  const snapshot = await db.collection(COLLECTION_NAME)
    .where('provider', '==', provider)
    .where('email', '==', email)
    .limit(1)
    .get();
  // ... decrypt and return
}
```

**Step 3: Add internal endpoint `GET /internal/users/:uid/oauth/github/token`**

This already works via the existing `GET /internal/users/:uid/oauth/google/token` pattern — just parameterized by provider. Verify the existing route handles `github` as provider. If the URL is hardcoded to `google`, add a parallel route for `github`.

Check: the existing route is `GET /internal/users/:uid/oauth/google/token` — hardcoded to Google. Add `GET /internal/users/:uid/oauth/github/token`.

**Step 4: Add internal endpoint `GET /internal/users/by-github-username/:username`**

New endpoint that calls `oauthConnectionRepository.findByProviderEmail('github', username)` and returns `{ userId }` or 404.

**Step 5: Write tests for new internal endpoints**

Mirror existing internal route tests in `apps/user-service/src/__tests__/internalRoutes.test.ts`.

**Step 6: Run tests, confirm pass**

```bash
pnpm run verify:workspace:tracked user-service
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat(user-service): add GitHub token and username lookup internal endpoints"
```

---

## Stream B: internal-clients + Infrastructure Cleanup [Model: sonnet, isolation: worktree]

### Task B1: Add GitHub Methods to UserServiceClient

**Files:**
- Modify: `packages/internal-clients/src/user-service/types.ts`
- Modify: `packages/internal-clients/src/user-service/client.ts`
- Test: `packages/internal-clients/src/user-service/__tests__/client.test.ts`

**Step 1: Update `OAuthProvider` type**

```typescript
export type OAuthProvider = 'google' | 'github';
```

**Step 2: Add `resolveGitHubUsername` to `UserServiceClient` interface**

```typescript
export interface UserServiceClient {
  // ... existing
  resolveGitHubUsername(
    username: string
  ): Promise<Result<{ userId: string } | null, UserServiceError>>;
}
```

**Step 3: Implement `resolveGitHubUsername`**

```typescript
async resolveGitHubUsername(
  username: string
): Promise<Result<{ userId: string } | null, UserServiceError>> {
  try {
    const response = await fetch(
      `${config.baseUrl}/internal/users/by-github-username/${encodeURIComponent(username)}`,
      { headers: { 'X-Internal-Auth': config.internalAuthToken } }
    );
    if (response.status === 404) return ok(null);
    if (!response.ok) {
      return err({ code: 'API_ERROR', message: `HTTP ${String(response.status)}` });
    }
    const body = (await response.json()) as { success: boolean; data: { userId: string } };
    return ok({ userId: body.data.userId });
  } catch (error) {
    return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
  }
}
```

**Step 4: Write nock tests** for both success and 404 cases.

**Step 5: Note:** The existing `getOAuthToken(userId, 'github')` already works for fetching the GitHub token — it's parameterized by provider. Just verify by adding a test case.

**Step 6: Run tests, build package**

```bash
pnpm run verify:workspace:tracked internal-clients
pnpm --filter @intexuraos/internal-clients build
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat(internal-clients): add GitHub OAuth and username resolution to UserServiceClient"
```

---

### Task B2: Infrastructure — Add GitHub OAuth Env Vars to user-service

**Files:**
- Modify: `terraform/environments/dev/main.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `scripts/verify-env-vars.mjs`

**Step 1: Add secrets to terraform**

In `terraform/environments/dev/main.tf`:
- Add to secrets map: `"INTEXURAOS_GITHUB_OAUTH_CLIENT_ID" = "GitHub OAuth App Client ID"`
- Add to secrets map: `"INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET" = "GitHub OAuth App Client Secret"`
- Add to user-service secrets block: both vars referencing `module.secret_manager.secret_ids`

**Step 2: Add to ecosystem.config.cjs**

Add to user-service env section:
```javascript
INTEXURAOS_GITHUB_OAUTH_CLIENT_ID: process.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_ID,
INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET: process.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET,
```

**Step 3: Update verify-env-vars.mjs**

Add both vars to `COMMON_OPTIONAL_ENV` OR verify they're checked via user-service's `REQUIRED_ENV`. Since user-service adds them to `REQUIRED_ENV`, the verify script should find them. Test by running `pnpm run verify:env-vars`.

**Step 4: Commit**

```bash
git add -A && git commit -m "infra: add GitHub OAuth env vars to user-service"
```

---

### Task B3: Infrastructure — Remove INTEXURAOS_GITHUB_API_TOKEN from code-agent

**Files:**
- Modify: `terraform/environments/dev/main.tf` — remove from code-agent secrets
- Modify: `ecosystem.config.cjs` — remove from code-agent env
- Modify: `scripts/verify-env-vars.mjs` — remove from `COMMON_OPTIONAL_ENV`

**Step 1: Remove from all three locations**

**Step 2: Commit**

```bash
git add -A && git commit -m "infra: remove INTEXURAOS_GITHUB_API_TOKEN from code-agent"
```

---

## Stream C: code-agent — Cleanup + Rewire [Model: opus, isolation: worktree]

This is the most complex stream — requires careful handling of `exactOptionalPropertyTypes`, test updates, and service container changes.

### Task C1: Remove githubApiToken from Config

**Files:**
- Modify: `apps/code-agent/src/config.ts`
- Modify: `apps/code-agent/src/__tests__/config.test.ts` (if testing this field)

**Step 1: Remove `githubApiToken` from `Config` interface and `loadConfig()` function**

**Step 2: Remove from `services.ts` — `ServiceConfig.githubApiToken` and the conditional spread**

**Step 3: Remove from `index.ts` — `githubApiToken: config.githubApiToken` in `initServices()` call

**Step 4: Run typecheck to find all broken references**

```bash
pnpm --filter code-agent exec tsc --noEmit
```

Fix all errors — this will cascade through services.ts, tests, etc.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(code-agent): remove INTEXURAOS_GITHUB_API_TOKEN config"
```

---

### Task C2: Remove Static gitHubPRClient from ServiceContainer

**Files:**
- Modify: `apps/code-agent/src/services.ts`
- Modify: all test files that call `setServices()`

**Step 1: Remove `gitHubPRClient?: GitHubPRClient` from `ServiceContainer`**

**Step 2: Remove `createGitHubPRHttpClient` import and conditional initialization from `initServices()`**

**Step 3: Remove `githubApiToken` from `ServiceConfig`**

**Step 4: Run typecheck, fix all broken `setServices()` calls in tests**

Search all tests: `grep -r "gitHubPRClient" apps/code-agent/src/__tests__/` — remove from all mock service objects.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(code-agent): remove static gitHubPRClient from ServiceContainer"
```

---

### Task C3: Remove githubUsername from WorkerSettings

**Files:**
- Modify: `apps/code-agent/src/domain/models/workerSettings.ts`
- Modify: `apps/code-agent/src/domain/ports/workerSettingsRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/workerSettingsRepository.ts`
- Modify: `apps/code-agent/src/routes/workerSettingsRoutes.ts`
- Delete tests related to githubUsername

**Step 1: Remove `githubUsername?: string` from `UserWorkerSettings` and `UserWorkerSettingsResponse`**

**Step 2: Remove `findByGitHubUsername()` and `updateGitHubUsername()` from `WorkerSettingsRepository` port**

**Step 3: Remove implementations from Firestore repository**

**Step 4: Remove `PATCH /code/worker-settings/github-username` route**

Remove the entire route handler, `githubUsernameSchema`, and the `githubUsername` field from the GET response.

**Step 5: Remove `githubUsername` from Firestore document parsing** (line 135-136 in workerSettingsRepository.ts)

**Step 6: Run typecheck, fix all references. Remove all related tests.**

```bash
pnpm --filter code-agent exec tsc --noEmit
```

**Step 7: Run tests, confirm pass**

```bash
pnpm run verify:workspace:tracked code-agent
```

**Step 8: Commit**

```bash
git add -A && git commit -m "refactor(code-agent): remove githubUsername from WorkerSettings"
```

---

### Task C4: Add UserServiceClient Dependency to code-agent

**Files:**
- Modify: `apps/code-agent/src/config.ts` — add `userServiceUrl: string`
- Modify: `apps/code-agent/src/services.ts` — add `userServiceClient` to ServiceContainer
- Modify: `apps/code-agent/src/index.ts` — add `INTEXURAOS_USER_SERVICE_URL` to env vars, wire into services
- Modify: `terraform/environments/dev/main.tf` — add env var to code-agent
- Modify: `ecosystem.config.cjs` — add env var to code-agent

**Step 1: Add `userServiceUrl` to `Config`**

```typescript
userServiceUrl: string;
```

And in `loadConfig()`:
```typescript
const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
```

**Step 2: Add `userServiceClient` to `ServiceContainer` and `ServiceConfig`**

```typescript
import { createUserServiceClient, type UserServiceClient } from '@intexuraos/internal-clients';

export interface ServiceContainer {
  // ... existing
  userServiceClient: UserServiceClient;
}
```

Wire in `initServices()`:
```typescript
userServiceClient: createUserServiceClient({
  baseUrl: config.userServiceUrl,
  internalAuthToken: config.internalAuthToken,
  // ... required fields from UserServiceConfig
}),
```

**Note:** `UserServiceConfig` requires `pricingContext` and `logger`. Check if code-agent has these. If `pricingContext` is complex, consider making it optional in the client or passing a stub. Read the `createUserServiceClient` function to understand what's actually required vs used.

**Step 3: Add `INTEXURAOS_USER_SERVICE_URL` to `PRODUCTION_ONLY_ENV` in `index.ts`**

**Step 4: Update all `setServices()` calls in tests — add `userServiceClient` mock**

**Step 5: Add env var to terraform and ecosystem.config.cjs**

**Step 6: Run tests**

```bash
pnpm run verify:workspace:tracked code-agent
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat(code-agent): add UserServiceClient dependency"
```

---

### Task C5: Rewire UserLookupService to Use UserServiceClient

**Files:**
- Modify: `apps/code-agent/src/domain/ports/userLookupService.ts`
- Modify: `apps/code-agent/src/infra/services/userLookupServiceImpl.ts`
- Test: `apps/code-agent/src/__tests__/infra/services/userLookupService.test.ts` (create if not exists, or modify existing)

**Step 1: Update `UserLookupServiceDeps`**

Replace `workerSettingsRepo` with `userServiceClient`:

```typescript
export interface UserLookupServiceDeps {
  userServiceClient: UserServiceClient;
  workerSettingsRepo: WorkerSettingsRepository; // still needed for worker config lookup
  logger: Logger;
}
```

The lookup flow becomes:
1. Call `userServiceClient.resolveGitHubUsername(username)` → get `userId`
2. Call `workerSettingsRepo.getSettings(userId)` → get first enabled worker
3. Return `{ userId, worker }`

**Step 2: Update implementation**

**Step 3: Write tests — mock both `userServiceClient` and `workerSettingsRepo`**

**Step 4: Update wiring in `services.ts`**

**Step 5: Run tests**

```bash
pnpm run verify:workspace:tracked code-agent
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor(code-agent): rewire UserLookupService to use UserServiceClient"
```

---

### Task C6: Rewire GitHubPRHttpClient to Accept Token Per-Call

**Files:**
- Modify: `apps/code-agent/src/domain/ports/gitHubPRClient.ts`
- Modify: `apps/code-agent/src/infra/http/gitHubPRHttpClient.ts`
- Modify: `apps/code-agent/src/__tests__/infra/http/gitHubPRHttpClient.test.ts`

**Step 1: Update port — add `token` parameter to `updatePRTitle`**

```typescript
export interface GitHubPRClient {
  updatePRTitle(
    token: string,
    owner: string,
    repo: string,
    prNumber: number,
    newTitle: string
  ): Promise<Result<void, GitHubPRClientError>>;
}
```

**Step 2: Update implementation — remove token from constructor config, accept per-call**

```typescript
export interface GitHubPRHttpClientConfig {
  timeoutMs: number;
}

export function createGitHubPRHttpClient(config: GitHubPRHttpClientConfig, logger: Logger): GitHubPRClient {
  return {
    async updatePRTitle(token, owner, repo, prNumber, newTitle) {
      // Use token in Authorization header
    }
  };
}
```

**Step 3: Update tests — pass token in each test call**

**Step 4: Run tests**

```bash
pnpm run verify:workspace:tracked code-agent
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(code-agent): make GitHubPRHttpClient accept token per-call"
```

---

### Task C7: Rewire createTaskForPR to Fetch User Token

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createTaskForPR.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts`
- Modify: `apps/code-agent/src/routes/webhooks/github.ts`

**Step 1: Update `CreateTaskForPRDeps`**

Replace `gitHubPRClient?: GitHubPRClient` with:
```typescript
gitHubPRClient: GitHubPRClient;
userServiceClient: UserServiceClient;
```

Both are now required (the client is always available, the token might not be).

**Step 2: Update PR title update logic**

Instead of checking `deps.gitHubPRClient !== undefined`, fetch the user's token:

```typescript
if (
  existingLinearIssueId === undefined &&
  linearResult.linearIssueId !== undefined &&
  request.prTitle !== undefined
) {
  const [owner, repo] = repository.split('/');
  if (owner !== undefined && repo !== undefined) {
    // Fetch user's GitHub token from user-service
    const tokenResult = await deps.userServiceClient.getOAuthToken(userId, 'github');
    if (tokenResult.ok) {
      const newTitle = `[${linearResult.linearIssueId}] ${request.prTitle}`;
      const titleResult = await deps.gitHubPRClient.updatePRTitle(
        tokenResult.value.accessToken, owner, repo, prNumber, newTitle
      );
      if (!titleResult.ok) {
        logger.warn(
          { error: titleResult.error, prNumber, linearIssueId: linearResult.linearIssueId },
          'Failed to update PR title with Linear issue ID (best-effort)'
        );
      }
    } else {
      logger.debug(
        { error: tokenResult.error, prNumber },
        'No GitHub OAuth token for user, skipping PR title update'
      );
    }
  }
}
```

**Step 3: Update route** — pass `gitHubPRClient` and `userServiceClient` from services.

The `gitHubPRClient` is now created without a token (just timeout config) and always available in services.

**Step 4: Update tests**

- Mock `userServiceClient.getOAuthToken` returning success/failure
- Remove the old "skips when gitHubPRClient undefined" test
- Add "skips when user has no GitHub OAuth token" test
- Update existing "updates PR title" test to mock token fetch

**Step 5: Run tests**

```bash
pnpm run verify:workspace:tracked code-agent
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat(code-agent): fetch per-user GitHub token for PR title update"
```

---

## Stream D: Web App — GitHub Page + Cleanup [Model: sonnet, isolation: worktree]

### Task D1: Create GitHub API Service

**Files:**
- Create: `apps/web/src/services/gitHubApi.ts`
- Modify: `apps/web/src/services/index.ts`
- Modify: `apps/web/src/types/index.ts`

**Step 1: Create API functions**

Mirror `apps/web/src/services/googleCalendarApi.ts`:

```typescript
export async function initiateGitHubOAuth(accessToken: string) { ... }
export async function getGitHubConnectionStatus(accessToken: string) { ... }
export async function disconnectGitHub(accessToken: string) { ... }
```

These call user-service endpoints: `POST /oauth/connections/github/initiate`, `GET /oauth/connections/github/status`, `DELETE /oauth/connections/github`.

**Step 2: Add `GitHubConnectionStatus` type**

```typescript
export interface GitHubConnectionStatus {
  connected: boolean;
  username?: string;
  scopes?: string[];
  createdAt?: string;
  updatedAt?: string;
}
```

**Step 3: Export from barrel**

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): add GitHub OAuth API service"
```

---

### Task D2: Create GitHubConnectionPage

**Files:**
- Create: `apps/web/src/pages/GitHubConnectionPage.tsx`
- Modify: `apps/web/src/pages/index.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Create page**

Mirror `GoogleCalendarConnectionPage.tsx` exactly:
- Shows "Connect with GitHub" button when not connected
- Shows connected account card with username, scopes, disconnect button
- Handles `oauth_success` and `oauth_error` query params
- Route: `/#/settings/github`

Key differences:
- Title: "GitHub" not "Google Calendar"
- Description: "Connect your GitHub account to allow IntexuraOS to manage pull requests on your behalf"
- Permissions requested: "Read and write access to your repositories", "Read your GitHub profile"
- Shows `username` instead of `email`

**Step 2: Add to page index barrel export**

**Step 3: Add route in `App.tsx`**

```tsx
<Route path="/settings/github" element={<ProtectedRoute><GitHubConnectionPage /></ProtectedRoute>} />
```

**Step 4: Add sidebar entry**

In `Sidebar.tsx`, add before the "Code Settings" entry:
```typescript
{ to: '/settings/github', label: 'GitHub', icon: Github },
```

Import `Github` from lucide-react.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): add GitHubConnectionPage"
```

---

### Task D3: Remove githubUsername from Worker Settings UI

**Files:**
- Modify: `apps/web/src/pages/WorkerSettingsPage.tsx`
- Modify: `apps/web/src/hooks/useWorkerSettings.ts`
- Modify: `apps/web/src/services/workerSettingsApi.ts`
- Modify: `apps/web/src/services/workerSettingsApi.types.ts`

**Step 1: Remove from `WorkerSettingsPage.tsx`**

- Remove `githubUsername` state, `isSavingGithub`, `githubSaveError`, `githubSaveSuccess` state
- Remove `useEffect` that initializes from `settings?.githubUsername`
- Remove the entire GitHub username input section (Input, Button, error/success messages)

**Step 2: Remove from `useWorkerSettings` hook**

- Remove `saveGitHubUsername` from the return interface and implementation
- Remove `handleSaveGitHubUsername` callback

**Step 3: Remove from API types**

- Remove `githubUsername?: string` from `WorkerSettingsResponse`
- Remove `SaveGitHubUsernameRequest` interface
- Remove `SaveGitHubUsernameResponse` interface

**Step 4: Remove from API service**

- Remove `saveGitHubUsernameApi` function from `workerSettingsApi.ts`

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(web): remove githubUsername from WorkerSettings UI"
```

---

## Stream E: Firestore Migration [Model: haiku, isolation: worktree]

### Task E1: Create Migration to Remove githubUsername Field

**Files:**
- Create: `migrations/NNNN-remove-github-username-from-worker-settings.mjs`

**Step 1: Determine next migration number**

```bash
ls migrations/*.mjs | sort | tail -1
```

**Step 2: Create migration**

```javascript
/**
 * Remove githubUsername field from worker_settings documents.
 * This field is being replaced by GitHub OAuth connections in oauth_connections collection.
 */
import { getFirestore } from 'firebase-admin/firestore';

export async function up(db) {
  const firestore = db || getFirestore();
  const snapshot = await firestore.collection('worker_settings').get();

  const batch = firestore.batch();
  let count = 0;

  for (const doc of snapshot.docs) {
    if (doc.data().githubUsername !== undefined) {
      batch.update(doc.ref, { githubUsername: FieldValue.delete() });
      count++;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  return { removed: count };
}
```

**Step 3: Commit**

```bash
git add -A && git commit -m "migration: remove githubUsername from worker_settings documents"
```

---

## Gate 1: Integration (main session, opus)

After all workstreams complete:

**Step 1: Merge all worktree branches into working branch**

```bash
git merge <stream-a-branch> <stream-b-branch> <stream-c-branch> <stream-d-branch> <stream-e-branch>
```

Resolve any merge conflicts (expected in `services.ts`, `index.ts`, `ecosystem.config.cjs`).

**Step 2: Build all packages**

```bash
pnpm build
```

**Step 3: Run full CI**

```bash
BRANCH=$(git branch --show-current | sed 's/\//-/g')
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-${BRANCH}-$(date +%Y%m%d-%H%M%S).txt
```

**Step 4: Fix any failures** — type errors, missing mocks, coverage gaps.

**Step 5: Commit integration fixes**

```bash
git add -A && git commit -m "fix: resolve integration issues from GitHub OAuth merge"
```

---

## Gate 2: Verification (automated review agents)

Dispatch these verification agents in parallel after CI passes:

### Verification 2a: Code Review [Model: opus, agent: code-reviewer]

Full code review of all changes. Focus on:
- Security: token handling, no token logging, proper encryption
- Pattern consistency: mirrors Google Calendar flow exactly
- Error handling: all Result types narrowed before access
- TypeScript strictness: `exactOptionalPropertyTypes` compliance

### Verification 2b: Consistency Check [Model: opus, agent: general-purpose]

Check cross-service consistency:
- All env vars in three locations (index.ts, terraform, ecosystem.config.cjs)
- All internal endpoints match between user-service routes and internal-clients
- `OAuthProvider` type matches everywhere (user-service model, internal-clients type)
- No orphaned references to `githubUsername` or `INTEXURAOS_GITHUB_API_TOKEN`

```bash
# Run these searches to verify complete cleanup:
grep -r "githubUsername" apps/ packages/ --include="*.ts" --include="*.tsx"
grep -r "GITHUB_API_TOKEN" apps/ packages/ terraform/ ecosystem.config.cjs scripts/
grep -r "githubApiToken" apps/ packages/ --include="*.ts"
```

### Verification 2c: Regression Testing [Model: sonnet, agent: general-purpose]

Run targeted workspace verification for all affected services:

```bash
pnpm run verify:workspace:tracked user-service
pnpm run verify:workspace:tracked code-agent
pnpm run verify:workspace:tracked internal-clients
```

Then full CI:
```bash
pnpm run ci:tracked
```

Verify test count hasn't dropped significantly (baseline: 9275 tests).

### Verification 2d: UX Verification [Model: sonnet, agent: general-purpose]

Check web app changes:
- `GitHubConnectionPage` follows same component pattern as `GoogleCalendarConnectionPage`
- Sidebar has GitHub entry with correct icon and route
- `WorkerSettingsPage` no longer has any GitHub username references
- Route exists in `App.tsx` at `/settings/github`
- API service functions use correct user-service endpoints
- Build succeeds: `pnpm --filter web build`

---

## Summary: Agent Assignment

| Stream | Agent Type        | Model  | Isolation | Dependencies     |
| ------ | ----------------- | ------ | --------- | ---------------- |
| A      | general-purpose   | sonnet | worktree  | Gate 0 (build)   |
| B      | general-purpose   | sonnet | worktree  | Gate 0 (build)   |
| C      | general-purpose   | opus   | worktree  | Gate 0 (build)   |
| D      | general-purpose   | sonnet | worktree  | Gate 0 (build)   |
| E      | general-purpose   | haiku  | worktree  | Gate 0 (build)   |
| Gate 1 | main session      | opus   | none      | A, B, C, D, E    |
| 2a     | code-reviewer     | opus   | none      | Gate 1           |
| 2b     | general-purpose   | opus   | none      | Gate 1           |
| 2c     | general-purpose   | sonnet | none      | Gate 1           |
| 2d     | general-purpose   | sonnet | none      | Gate 1           |
