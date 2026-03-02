# GitHub OAuth for IntexuraOS

**Date:** 2026-03-02
**Status:** Approved

## Problem

Code-agent needs to perform GitHub API operations (PR title updates, future: comments, labels) on behalf of users. The current approach uses a single static `INTEXURAOS_GITHUB_API_TOKEN` env var — one identity for all users. This doesn't scale to multi-user and the token isn't verified against any user identity.

Additionally, `githubUsername` is stored manually (user types it) in `worker_settings` Firestore documents owned by code-agent. This is unverified and in the wrong location.

## Solution

Add GitHub OAuth App support following the existing Google Calendar OAuth pattern in user-service. Per-user GitHub tokens stored encrypted in `oauth_connections`. Full cleanup of all legacy code.

## Decisions

| Decision              | Choice                                | Rationale                                                  |
| --------------------- | ------------------------------------- | ---------------------------------------------------------- |
| App type              | GitHub OAuth App                      | Tokens don't expire (no refresh complexity)                |
| Scopes                | `repo read:user`                      | Full repo access + verified username. Future-proof.        |
| Username lookup       | New internal endpoint on user-service | Clean separation — user-service owns all identity data     |
| Migration             | Hard cleanup, no backwards compat     | Delete `githubUsername` from Firestore + all related code  |

## Architecture

```
Web App                    user-service                     GitHub
  |                            |                              |
| -- POST /oauth/.../initiate -->                             |                              |
| ----------------------------------------------------------- | ---------------------------- |
| -- redirect to GitHub -------->                             | -------------------------->  |
|                                                             | <-- callback ?code=...  ---  |
|                                                             | -- POST /access_token ---->  |
|                                                             | <-- { access_token } ------  |
|                                                             | -- GET /user --------------> |
|                                                             | <-- { login: "octocat" } --  |
|                                                             | -- save to oauth_connections |
| <-- redirect /#/settings/github?oauth_success=true -------- |

code-agent                  user-service
  |                            |
| -- GET /internal/users/by-github-username/:username --> |
| ------------------------------------------------------- |
| -- GET /internal/users/:uid/oauth/github/token -------> |
| <-- { accessToken, username } ------------------------- |
| -- PATCH github.com/repos/.../pulls/... (user's token)  |
```

## Components by Service

### 1. user-service (OAuth provider owner)

**New port:** `GitHubOAuthClient`
- `generateAuthUrl(state, redirectUri)` → `https://github.com/login/oauth/authorize`
- `exchangeCode(code)` → `POST https://github.com/login/oauth/access_token`
- `getUserInfo(accessToken)` → `GET https://api.github.com/user` → `{ username }`
- `revokeToken(token)` → `DELETE https://api.github.com/applications/{client_id}/grant`
- No `refreshAccessToken` — GitHub OAuth App tokens don't expire

**New impl:** `GitHubOAuthClientImpl` (mirrors `GoogleOAuthClientImpl`)

**Model change:** `OAuthProviders.GITHUB = 'github'`

**New routes:**
- `POST /oauth/connections/github/initiate` — start OAuth flow
- `GET /oauth/connections/github/callback` — exchange code, save connection
- `GET /oauth/connections/github/status` — check connection status
- `DELETE /oauth/connections/github` — disconnect

**New internal endpoints:**
- `GET /internal/users/:uid/oauth/github/token` — returns `{ accessToken, username }`
- `GET /internal/users/by-github-username/:username` — returns `{ userId }` or 404

**Token behavior:** `getValidAccessToken` for GitHub skips refresh (tokens don't expire). If GitHub API returns 401 on use, connection is stale — delete and return `CONNECTION_NOT_FOUND`.

**Storage:** `oauth_connections/{userId}_github` — same collection, same AES-256-GCM encryption. The `email` field stores the GitHub username (login) since that's the primary identifier.

**New env vars:** `INTEXURAOS_GITHUB_OAUTH_CLIENT_ID`, `INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET`

### 2. code-agent (consumer)

**Delete completely:**
- `INTEXURAOS_GITHUB_API_TOKEN` from config, services, index, terraform, ecosystem.config.cjs, verify-env-vars.mjs
- `githubUsername` from `UserWorkerSettings` model, response types
- `findByGitHubUsername()`, `updateGitHubUsername()` from `WorkerSettingsRepository` port + impl
- `PATCH /code/worker-settings/github-username` route + schema + tests
- `githubUsername` handling in `GET /code/worker-settings` response
- Static `gitHubPRClient` from `ServiceContainer`

**Modify:**
- `GitHubPRHttpClient`: accept token per-call instead of at construction
- `UserLookupService`: call user-service `GET /internal/users/by-github-username/:username` instead of querying worker_settings
- `createTaskForPR`: fetch user's GitHub token from user-service, pass to `GitHubPRClient`

**New dependency:** `INTEXURAOS_USER_SERVICE_URL` (check if already present)

### 3. web app

**New:**
- `GitHubConnectionPage.tsx` at `/#/settings/github` (mirrors `GoogleCalendarConnectionPage`)
- API service: `initiateGitHubOAuth`, `getGitHubStatus`, `disconnectGitHub`
- Sidebar entry: `{ to: '/settings/github', label: 'GitHub', icon: Github }`
- Route in `App.tsx`

**Delete:**
- `githubUsername` text field from `WorkerSettingsPage.tsx`
- `saveGitHubUsername` from `useWorkerSettings` hook
- `SaveGitHubUsernameRequest`, `SaveGitHubUsernameResponse`, `saveGitHubUsernameApi` from API types/service
- `githubUsername` from `WorkerSettingsResponse` type

### 4. packages/internal-clients

**Add to `UserServiceClient`:**
- `getGitHubOAuthToken(userId)` → `GET /internal/users/:uid/oauth/github/token`
- `resolveGitHubUsername(username)` → `GET /internal/users/by-github-username/:username`

### 5. Firestore Migration

**New migration:** Remove `githubUsername` field from all `worker_settings` documents. Field deletion only — worker configs stay intact.

### 6. Infrastructure

**Add (user-service):**
- `INTEXURAOS_GITHUB_OAUTH_CLIENT_ID` — terraform secret + ecosystem.config.cjs
- `INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET` — terraform secret + ecosystem.config.cjs

**Remove (code-agent):**
- `INTEXURAOS_GITHUB_API_TOKEN` — terraform, ecosystem.config.cjs, verify-env-vars.mjs, config, index

## Endpoint Changes

### user-service

| Method | Path                                              | Change  |
| ------ | ------------------------------------------------- | ------- |
| POST   | `/oauth/connections/github/initiate`              | Created |
| GET    | `/oauth/connections/github/callback`              | Created |
| GET    | `/oauth/connections/github/status`                | Created |
| DELETE | `/oauth/connections/github`                       | Created |
| GET    | `/internal/users/:uid/oauth/github/token`         | Created |
| GET    | `/internal/users/by-github-username/:username`    | Created |

### code-agent

| Method | Path                                        | Change  |
| ------ | ------------------------------------------- | ------- |
| PATCH  | `/code/worker-settings/github-username`     | Removed |
