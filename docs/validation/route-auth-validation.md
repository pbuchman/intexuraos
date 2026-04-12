# Route Authentication Cross-Validation Report

**Generated:** 2026-02-19
**Scope:** All HTTP routes across 20 apps
**Method:** Code analysis of all route files in `apps/*/src/routes/`

## Summary

| Metric                                                        | Count                        |
| ------------------------------------------------------------- | ---------------------------- |
| Total apps audited                                            | 20                           |
| Total route files read                                        | 45+                          |
| Routes with proper auth                                       | All (see per-service matrix) |
| CRITICAL issues (internal route missing validateInternalAuth) | 0                            |
| HIGH issues (public route missing JWT)                        | 0                            |
| MEDIUM issues (convention deviation)                          | 1                            |
| LOW issues (webhook without signature check)                  | 1                            |
| Intentionally unauthenticated routes                          | 9                            |

**Overall status: PASS** — No CRITICAL or HIGH severity issues found.

---

## Auth Patterns Reference

| Pattern                  | Used By                                                 | Mechanism                                          |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| `validateInternalAuth()` | All services                                            | `X-Internal-Auth` header validation                |
| `requireAuth()`          | All services                                            | Auth0 JWT bearer token                             |
| `tryAuth()`              | chat-agent, user-service                                | Optional JWT (guest-capable)                       |
| PubSub OIDC              | Actions, bookmarks, calendar, commands, todos, whatsapp | Cloud Run validates OIDC from `noreply@google.com` |
| OIDC Bearer              | Actions, commands, linear                               | `Authorization: Bearer` token from Cloud Scheduler |
| HMAC-SHA256              | code-agent, whatsapp-service, mobile-notifications      | Signature header verification                      |
| Custom signature         | linear-agent                                            | `validateLinearWebhookSignature()`                 |
| Verify token             | whatsapp-service                                        | `hub.verify_token` query param comparison          |
| `onRequest` JWT hook     | code-agent                                              | Fastify `jwtValidator` middleware                  |

---

## Per-Service Auth Matrix

### actions-agent

| Method | Path                                 | Auth Type                               | Status |
| ------ | ------------------------------------ | --------------------------------------- | ------ |
| GET    | /actions                             | `requireAuth()`                         | OK     |
| PATCH  | /actions/:actionId                   | `requireAuth()`                         | OK     |
| DELETE | /actions/:actionId                   | `requireAuth()`                         | OK     |
| POST   | /actions/batch                       | `requireAuth()`                         | OK     |
| POST   | /actions/:actionId/execute           | `requireAuth()`                         | OK     |
| GET    | /actions/:actionId/preview           | `requireAuth()`                         | OK     |
| POST   | /actions/:actionId/resolve-duplicate | `requireAuth()`                         | OK     |
| POST   | /internal/actions                    | `validateInternalAuth()`                | OK     |
| POST   | /internal/actions/:actionType        | PubSub OIDC or `validateInternalAuth()` | OK     |
| POST   | /internal/actions/process            | PubSub OIDC or `validateInternalAuth()` | OK     |
| POST   | /internal/actions/retry-pending      | OIDC Bearer or `validateInternalAuth()` | OK     |
| POST   | /internal/actions/approval-reply     | PubSub OIDC or `validateInternalAuth()` | OK     |
| PATCH  | /internal/actions/:actionId/status   | `validateInternalAuth()`                | OK     |

### app-settings-service

| Method | Path                  | Auth Type                | Status                                                          |
| ------ | --------------------- | ------------------------ | --------------------------------------------------------------- |
| GET    | /settings/pricing     | `requireAuth()`          | OK                                                              |
| GET    | /settings/pricing     | `validateInternalAuth()` | OK (MEDIUM: path not `/internal/` prefixed — see discrepancies) |

### bookmarks-agent

| Method | Path                                  | Auth Type                               | Status                                   |
| ------ | ------------------------------------- | --------------------------------------- | ---------------------------------------- |
| GET    | /bookmarks                            | `requireAuth()`                         | OK                                       |
| GET    | /bookmarks/:id                        | `requireAuth()`                         | OK                                       |
| POST   | /bookmarks                            | `requireAuth()`                         | OK                                       |
| PATCH  | /bookmarks/:id                        | `requireAuth()`                         | OK                                       |
| DELETE | /bookmarks/:id                        | `requireAuth()`                         | OK                                       |
| GET    | /images/proxy                         | None                                    | OK (intentional — proxies public images) |
| POST   | /internal/bookmarks                   | `validateInternalAuth()`                | OK                                       |
| GET    | /internal/bookmarks/:id               | `validateInternalAuth()`                | OK                                       |
| PATCH  | /internal/bookmarks/:id               | `validateInternalAuth()`                | OK                                       |
| POST   | /internal/bookmarks/:id/force-refresh | `validateInternalAuth()`                | OK                                       |
| POST   | /internal/bookmarks/pubsub/enrich     | PubSub OIDC or `validateInternalAuth()` | OK                                       |
| POST   | /internal/bookmarks/pubsub/summarize  | PubSub OIDC or `validateInternalAuth()` | OK                                       |

### calendar-agent

| Method | Path                                   | Auth Type                               | Status |
| ------ | -------------------------------------- | --------------------------------------- | ------ |
| GET    | /calendar/events                       | `requireAuth()`                         | OK     |
| POST   | /calendar/events                       | `requireAuth()`                         | OK     |
| PATCH  | /calendar/events/:eventId              | `requireAuth()`                         | OK     |
| DELETE | /calendar/events/:eventId              | `requireAuth()`                         | OK     |
| POST   | /calendar/freebusy                     | `requireAuth()`                         | OK     |
| GET    | /calendar/failed-events                | `requireAuth()`                         | OK     |
| DELETE | /calendar/failed-events/:eventId       | `requireAuth()`                         | OK     |
| POST   | /calendar/failed-events/:eventId/retry | `requireAuth()`                         | OK     |
| POST   | /internal/calendar/process-action      | `validateInternalAuth()`                | OK     |
| POST   | /internal/calendar/generate-preview    | PubSub OIDC or `validateInternalAuth()` | OK     |
| GET    | /internal/calendar/preview/:actionId   | `validateInternalAuth()`                | OK     |

### chat-agent

| Method | Path  | Auth Type                   | Status                        |
| ------ | ----- | --------------------------- | ----------------------------- |
| POST   | /chat | `tryAuth()` + rate limiting | OK (intentional guest access) |

### code-agent

| Method | Path                               | Auth Type                               | Status |
| ------ | ---------------------------------- | --------------------------------------- | ------ |
| GET    | /code/tasks                        | `jwtValidator` (onRequest hook)         | OK     |
| POST   | /code/tasks                        | `jwtValidator` (onRequest hook)         | OK     |
| GET    | /code/tasks/:taskId                | `jwtValidator` (onRequest hook)         | OK     |
| GET    | /code/tasks/:taskId/events         | `jwtValidator` (onRequest hook)         | OK     |
| GET    | /code/tasks/:taskId/pr-events      | `jwtValidator` (onRequest hook)         | OK     |
| GET    | /code/tasks/:taskId/pr-summaries   | `jwtValidator` (onRequest hook)         | OK     |
| GET    | /code/worker-settings              | `jwtValidator` (onRequest hook)         | OK     |
| PUT    | /code/worker-settings              | `jwtValidator` (onRequest hook)         | OK     |
| DELETE | /code/worker-settings              | `jwtValidator` (onRequest hook)         | OK     |
| GET    | /code/worker-settings/oauth-status | `jwtValidator` (onRequest hook)         | OK     |
| GET    | /code/worker-settings/branches     | `jwtValidator` (onRequest hook)         | OK     |
| POST   | /code/worker-settings/test         | `jwtValidator` (onRequest hook)         | OK     |
| POST   | /webhooks/github                   | HMAC-SHA256 (`verifyGitHubSignature()`) | OK     |

### commands-agent

| Method | Path                          | Auth Type                               | Status |
| ------ | ----------------------------- | --------------------------------------- | ------ |
| GET    | /commands                     | `requireAuth()`                         | OK     |
| POST   | /commands                     | `requireAuth()`                         | OK     |
| DELETE | /commands/:commandId          | `requireAuth()`                         | OK     |
| PATCH  | /commands/:commandId          | `requireAuth()`                         | OK     |
| POST   | /internal/commands            | PubSub OIDC or `validateInternalAuth()` | OK     |
| POST   | /internal/retry-pending       | OIDC Bearer or `validateInternalAuth()` | OK     |
| GET    | /internal/commands/:commandId | `validateInternalAuth()`                | OK     |

### data-insights-agent

| Method | Path                             | Auth Type                | Status |
| ------ | -------------------------------- | ------------------------ | ------ |
| POST   | /internal/visualizations/compute | `validateInternalAuth()` | OK     |

### image-service

| Method | Path                              | Auth Type                | Status |
| ------ | --------------------------------- | ------------------------ | ------ |
| POST   | /internal/images/prompts/generate | `validateInternalAuth()` | OK     |
| POST   | /internal/images/generate         | `validateInternalAuth()` | OK     |
| DELETE | /internal/images/:id              | `validateInternalAuth()` | OK     |

### linear-agent

| Method | Path                                         | Auth Type                               | Status |
| ------ | -------------------------------------------- | --------------------------------------- | ------ |
| GET    | /linear/issues                               | `requireAuth()`                         | OK     |
| POST   | /linear/issues                               | `requireAuth()`                         | OK     |
| GET    | /linear/issues/:identifier                   | `requireAuth()`                         | OK     |
| PATCH  | /linear/issues/:identifier                   | `requireAuth()`                         | OK     |
| GET    | /linear/cycles                               | `requireAuth()`                         | OK     |
| GET    | /linear/projects                             | `requireAuth()`                         | OK     |
| POST   | /linear/webhooks                             | `validateLinearWebhookSignature()`      | OK     |
| POST   | /internal/linear/process-action              | `validateInternalAuth()`                | OK     |
| GET    | /internal/linear/issues/:identifier/validate | `validateInternalAuth()`                | OK     |
| POST   | /internal/linear/issues/generate-title       | `validateInternalAuth()`                | OK     |
| POST   | /internal/linear/sync-all                    | OIDC Bearer or `validateInternalAuth()` | OK     |
| POST   | /internal/linear/sync                        | `validateInternalAuth()`                | OK     |
| POST   | /internal/issues                             | `validateInternalAuth()`                | OK     |

### mobile-notifications-service

| Method | Path                                 | Auth Type                                           | Status |
| ------ | ------------------------------------ | --------------------------------------------------- | ------ |
| POST   | /mobile-notifications/connect        | `requireAuth()`                                     | OK     |
| POST   | /mobile-notifications/webhooks       | HMAC signature (`x-mobile-notifications-signature`) | OK     |
| POST   | /internal/mobile-notifications/query | `validateInternalAuth()`                            | OK     |

### notes-agent

| Method | Path            | Auth Type                | Status |
| ------ | --------------- | ------------------------ | ------ |
| GET    | /notes          | `requireAuth()`          | OK     |
| POST   | /notes          | `requireAuth()`          | OK     |
| GET    | /notes/:noteId  | `requireAuth()`          | OK     |
| PATCH  | /notes/:noteId  | `requireAuth()`          | OK     |
| DELETE | /notes/:noteId  | `requireAuth()`          | OK     |
| POST   | /internal/notes | `validateInternalAuth()` | OK     |

### notion-service

| Method | Path                                   | Auth Type                | Status                         |
| ------ | -------------------------------------- | ------------------------ | ------------------------------ |
| GET    | /internal/notion/users/:userId/context | `validateInternalAuth()` | OK                             |
| POST   | /notion-webhooks                       | None                     | LOW (stub — see discrepancies) |

### research-agent

| Method | Path                       | Auth Type                | Status |
| ------ | -------------------------- | ------------------------ | ------ |
| GET    | /research                  | `requireAuth()`          | OK     |
| POST   | /research                  | `requireAuth()`          | OK     |
| GET    | /research/:researchId      | `requireAuth()`          | OK     |
| POST   | /internal/research/process | `validateInternalAuth()` | OK     |

### todos-agent

| Method | Path                                    | Auth Type                               | Status |
| ------ | --------------------------------------- | --------------------------------------- | ------ |
| GET    | /todos                                  | `requireAuth()`                         | OK     |
| POST   | /todos                                  | `requireAuth()`                         | OK     |
| GET    | /todos/:todoId                          | `requireAuth()`                         | OK     |
| PATCH  | /todos/:todoId                          | `requireAuth()`                         | OK     |
| DELETE | /todos/:todoId                          | `requireAuth()`                         | OK     |
| POST   | /internal/todos                         | `validateInternalAuth()`                | OK     |
| POST   | /internal/todos/pubsub/todos-processing | PubSub OIDC or `validateInternalAuth()` | OK     |

### user-service

| Method | Path                                      | Auth Type                      | Status                                                          |
| ------ | ----------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| GET    | /auth/login                               | None                           | OK (intentional — redirects to Auth0)                           |
| GET    | /auth/logout                              | None                           | OK (intentional — clears session)                               |
| GET    | /auth/callback                            | None                           | OK (intentional — OAuth2 callback)                              |
| GET    | /auth/me                                  | `requireAuth()` or `tryAuth()` | OK                                                              |
| GET    | /auth/config                              | None                           | OK (intentional — public client config)                         |
| POST   | /auth/refresh                             | None                           | OK (intentional — pre-auth token refresh)                       |
| POST   | /auth/oauth/token                         | None                           | OK (intentional — OAuth2 token exchange, uses client_id/secret) |
| GET    | /users/settings                           | `requireAuth()`                | OK                                                              |
| PUT    | /users/settings                           | `requireAuth()`                | OK                                                              |
| GET    | /users/llm-keys                           | `requireAuth()`                | OK                                                              |
| POST   | /users/llm-keys                           | `requireAuth()`                | OK                                                              |
| DELETE | /users/llm-keys/:provider                 | `requireAuth()`                | OK                                                              |
| GET    | /users/oauth-connections                  | `requireAuth()`                | OK                                                              |
| POST   | /users/oauth-connections                  | `requireAuth()`                | OK                                                              |
| DELETE | /users/oauth-connections/:provider        | `requireAuth()`                | OK                                                              |
| GET    | /internal/users/:userId                   | `validateInternalAuth()`       | OK                                                              |
| POST   | /internal/users                           | `validateInternalAuth()`       | OK                                                              |
| PATCH  | /internal/users/:userId                   | `validateInternalAuth()`       | OK                                                              |
| GET    | /internal/users/:userId/llm-keys          | `validateInternalAuth()`       | OK                                                              |
| GET    | /internal/users/:userId/oauth-connections | `validateInternalAuth()`       | OK                                                              |

### web-agent

| Method | Path                    | Auth Type                | Status |
| ------ | ----------------------- | ------------------------ | ------ |
| POST   | /internal/link-previews | `validateInternalAuth()` | OK     |

### whatsapp-service

| Method | Path                         | Auth Type                                  | Status |
| ------ | ---------------------------- | ------------------------------------------ | ------ |
| GET    | /whatsapp/messages           | `requireAuth()`                            | OK     |
| POST   | /whatsapp/messages           | `requireAuth()`                            | OK     |
| GET    | /whatsapp/mappings           | `requireAuth()`                            | OK     |
| POST   | /whatsapp/mappings           | `requireAuth()`                            | OK     |
| DELETE | /whatsapp/mappings/:id       | `requireAuth()`                            | OK     |
| POST   | /whatsapp/verify             | `requireAuth()`                            | OK     |
| GET    | /whatsapp/webhooks           | Verify token (`hub.verify_token`)          | OK     |
| POST   | /whatsapp/webhooks           | HMAC-SHA256 (`validateWebhookSignature()`) | OK     |
| POST   | /internal/whatsapp/pubsub/\* | PubSub OIDC or `validateInternalAuth()`    | OK     |

---

## Discrepancies

### [MEDIUM] app-settings-service — Internal route path convention deviation

**File:** `apps/app-settings-service/src/routes/internalRoutes.ts`
**Route:** `GET /settings/pricing`
**Issue:** This route is registered in `internalRoutes.ts` and protected by `validateInternalAuth()`, but its path does not follow the `/internal/*` prefix convention used by all other internal routes.

The same resource path `/settings/pricing` is served by both:

- `internalRoutes.ts` at `GET /settings/pricing` (for service-to-service calls, validates `X-Internal-Auth`)
- `publicRoutes.ts` at `GET /settings/pricing` (for authenticated users, validates JWT)

Both routes are properly protected. The issue is that the internal route is indistinguishable from a public route by path alone, which deviates from the architecture convention (`/internal/{resource-name}` for service-to-service endpoints).

**Recommendation:** Rename the internal route path to `GET /internal/settings/pricing` and update any services that call it.

---

### [LOW] notion-service — Webhook stub has no signature verification

**File:** `apps/notion-service/src/routes/webhookRoutes.ts`
**Route:** `POST /notion-webhooks`
**Issue:** The Notion webhook endpoint accepts any JSON payload with no HMAC signature verification. The route is documented as a stub that accepts events but performs no side effects.

When Notion webhook integration is fully implemented, HMAC signature verification must be added using the `x-notion-signature` header (or equivalent Notion verification mechanism).

**Recommendation:** When activating Notion webhook processing, add signature verification before processing any payload. Until then, this stub presents minimal risk as it has no side effects.

---

## Intentionally Unauthenticated Routes

These routes have no authentication by design:

| Service          | Method | Path               | Reason                                                              |
| ---------------- | ------ | ------------------ | ------------------------------------------------------------------- |
| bookmarks-agent  | GET    | /images/proxy      | Proxies already-public images; no user data involved                |
| chat-agent       | POST   | /chat              | Guest access intentional; rate-limited via `x-guest-session` header |
| user-service     | GET    | /auth/login        | Redirects to Auth0; pre-authentication flow                         |
| user-service     | GET    | /auth/logout       | Clears session; no protected data                                   |
| user-service     | GET    | /auth/callback     | OAuth2 callback handler; pre-authentication                         |
| user-service     | GET    | /auth/config       | Returns public client configuration (non-secret)                    |
| user-service     | POST   | /auth/refresh      | Pre-auth token refresh; no JWT exists yet                           |
| user-service     | POST   | /auth/oauth/token  | OAuth2 client credentials exchange                                  |
| whatsapp-service | GET    | /whatsapp/webhooks | Meta verification challenge (verify token only)                     |

---

## Action Items

| Priority | Service              | Action                                                                                                           |
| -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| MEDIUM   | app-settings-service | Rename internal route `GET /settings/pricing` → `GET /internal/settings/pricing` to comply with path convention  |
| LOW      | notion-service       | When activating Notion webhook processing, add `x-notion-signature` HMAC verification before processing payloads |

---

## Notes on Auth Patterns

### PubSub OIDC Dual-Auth Pattern

Multiple services use a dual-auth pattern for PubSub push endpoints:

```typescript
const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';
if (isPubSubPush) {
  // Cloud Run already validated OIDC token at transport layer
} else {
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) return reply.fail('UNAUTHORIZED', ...);
}
```

This allows the same endpoint to be called by Cloud Pub/Sub (OIDC) or other internal services (`X-Internal-Auth`). The OIDC check is safe because Cloud Run validates the token before forwarding the request.

### Cloud Scheduler OIDC Pattern

Some scheduler-triggered endpoints accept an OIDC Bearer token as an alternative to `X-Internal-Auth`:

```typescript
const authHeader = request.headers.authorization;
const isOidcBearer = authHeader?.startsWith('Bearer ');
if (isOidcBearer) {
  // Cloud Run validated OIDC token; trust the request
} else {
  const authResult = validateInternalAuth(request);
  ...
}
```

### code-agent JWT Pattern

Unlike other services that use `requireAuth()` per-handler, code-agent registers a `jwtValidator` Fastify plugin and applies it via `onRequest` hook at route registration time. The security guarantee is equivalent but the implementation differs.
