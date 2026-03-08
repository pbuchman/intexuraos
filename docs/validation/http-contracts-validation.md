# HTTP Contracts Cross-Validation Report

**Generated:** 2026-02-19
**Scope:** All HTTP endpoints (public, internal, webhooks) across 20 apps + 4 workers
**Method:** Documentation-first, traced to code (Enhanced v3) — supersedes 2026-02-08 report

> **v3 Enhancement:** This run expanded scope from 15 internal-only services to all 20 apps with full public + webhook endpoint coverage. Previous D6/D7 (code-agent path mismatches) and D5 (linear-agent missing endpoints) from the Feb 08 report have been resolved in docs updates; those findings are not repeated here.

---

## v3 Summary (2026-02-19)

| Category                          | Count |
| --------------------------------- | ----- |
| Services audited                  | 20    |
| Total endpoints verified          | 181   |
| Endpoints confirmed in code       | 181   |
| Undocumented endpoints in code    | 2     |
| Phantom endpoints (docs, no code) | 0     |
| Path mismatches (docs ≠ code)     | 0     |
| **Open discrepancies**            | **2** |

**Result: PASS with 2 documentation gaps (no phantom or broken endpoints)**

---

## v3 Complete Endpoint Registry (2026-02-19)

All routes verified against `apps/*/src/routes/`. Auth: `Bearer` = Auth0 JWT, `Internal` = X-Internal-Auth header, `OIDC` = Cloud Run service-to-service, `HMAC` = webhook signature, `None` = unauthenticated.

### actions-agent

| Method | Path                                 | Auth             | Route File        | Status |
| ------ | ------------------------------------ | ---------------- | ----------------- | ------ |
| GET    | `/actions`                           | Bearer           | actionRoutes.ts   | OK     |
| GET    | `/actions/:id`                       | Bearer           | actionRoutes.ts   | OK     |
| PATCH  | `/actions/:actionId`                 | Bearer           | actionRoutes.ts   | OK     |
| POST   | `/internal/actions`                  | Internal or OIDC | internalRoutes.ts | OK     |
| POST   | `/internal/actions/:actionType`      | Pub/Sub OIDC     | internalRoutes.ts | OK     |
| POST   | `/internal/actions/process`          | Pub/Sub OIDC     | internalRoutes.ts | OK     |
| POST   | `/internal/actions/retry-pending`    | OIDC or Internal | internalRoutes.ts | OK     |
| POST   | `/internal/actions/approval-reply`   | Pub/Sub OIDC     | internalRoutes.ts | OK     |
| PATCH  | `/internal/actions/:actionId/status` | Internal         | internalRoutes.ts | ⚠ D1   |

### api-docs-hub

| Method | Path      | Auth | Route File | Status |
| ------ | --------- | ---- | ---------- | ------ |
| GET    | `/docs`   | None | server.ts  | OK     |
| GET    | `/health` | None | server.ts  | OK     |

### app-settings-service

| Method | Path                    | Auth     | Route File        | Status |
| ------ | ----------------------- | -------- | ----------------- | ------ |
| GET    | `/settings/pricing`     | None     | publicRoutes.ts   | OK     |
| GET    | `/settings/usage-costs` | Bearer   | publicRoutes.ts   | OK     |
| GET    | `/settings/pricing`     | Internal | internalRoutes.ts | OK     |

### bookmarks-agent

| Method | Path                                    | Auth     | Route File        | Status |
| ------ | --------------------------------------- | -------- | ----------------- | ------ |
| GET    | `/bookmarks`                            | Bearer   | bookmarkRoutes.ts | OK     |
| POST   | `/bookmarks`                            | Bearer   | bookmarkRoutes.ts | OK     |
| GET    | `/bookmarks/:id`                        | Bearer   | bookmarkRoutes.ts | OK     |
| PATCH  | `/bookmarks/:id`                        | Bearer   | bookmarkRoutes.ts | OK     |
| DELETE | `/bookmarks/:id`                        | Bearer   | bookmarkRoutes.ts | OK     |
| POST   | `/bookmarks/:id/archive`                | Bearer   | bookmarkRoutes.ts | OK     |
| POST   | `/bookmarks/:id/unarchive`              | Bearer   | bookmarkRoutes.ts | OK     |
| GET    | `/images/proxy`                         | None     | bookmarkRoutes.ts | OK     |
| POST   | `/internal/bookmarks`                   | Internal | internalRoutes.ts | OK     |
| GET    | `/internal/bookmarks/:id`               | Internal | internalRoutes.ts | OK     |
| PATCH  | `/internal/bookmarks/:id`               | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/bookmarks/:id/force-refresh` | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/bookmarks/pubsub/enrich`     | OIDC     | pubsubRoutes.ts   | OK     |
| POST   | `/internal/bookmarks/pubsub/summarize`  | OIDC     | pubsubRoutes.ts   | OK     |

### calendar-agent

| Method | Path                                   | Auth     | Route File        | Status |
| ------ | -------------------------------------- | -------- | ----------------- | ------ |
| GET    | `/calendar/events`                     | Bearer   | calendarRoutes.ts | OK     |
| GET    | `/calendar/events/:eventId`            | Bearer   | calendarRoutes.ts | OK     |
| POST   | `/calendar/events`                     | Bearer   | calendarRoutes.ts | OK     |
| PATCH  | `/calendar/events/:eventId`            | Bearer   | calendarRoutes.ts | OK     |
| DELETE | `/calendar/events/:eventId`            | Bearer   | calendarRoutes.ts | OK     |
| GET    | `/calendar/freebusy`                   | Bearer   | calendarRoutes.ts | OK     |
| GET    | `/calendar/failed-events`              | Bearer   | calendarRoutes.ts | OK     |
| DELETE | `/calendar/failed-events/:id`          | Bearer   | calendarRoutes.ts | OK     |
| POST   | `/calendar/failed-events/:id/retry`    | Bearer   | calendarRoutes.ts | OK     |
| POST   | `/internal/calendar/process-action`    | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/calendar/generate-preview`  | Internal | internalRoutes.ts | OK     |
| GET    | `/internal/calendar/preview/:actionId` | Internal | internalRoutes.ts | OK     |

### chat-agent

| Method | Path    | Auth   | Route File    | Status |
| ------ | ------- | ------ | ------------- | ------ |
| POST   | `/chat` | Bearer | chatRoutes.ts | OK     |

### claude-worker

Workers run as Cloud Functions, not Cloud Run. No HTTP endpoints — event-driven via Cloud Events.

### code-agent

| Method | Path                                                | Auth          | Route File              | Status |
| ------ | --------------------------------------------------- | ------------- | ----------------------- | ------ |
| POST   | `/code/submit`                                      | Bearer        | codeRoutes.ts           | OK     |
| GET    | `/code/tasks`                                       | Bearer        | codeRoutes.ts           | OK     |
| GET    | `/code/tasks/:taskId`                               | Bearer        | codeRoutes.ts           | OK     |
| DELETE | `/code/tasks/:taskId`                               | Bearer        | codeRoutes.ts           | OK     |
| POST   | `/code/cancel`                                      | Bearer        | codeRoutes.ts           | OK     |
| POST   | `/code/retry`                                       | Bearer        | codeRoutes.ts           | OK     |
| GET    | `/code/workers/status`                              | Bearer        | codeRoutes.ts           | OK     |
| POST   | `/code/workers/refresh-status`                      | Bearer        | codeRoutes.ts           | OK     |
| GET    | `/code/github-pr-events`                            | Bearer        | codeRoutes.ts           | OK     |
| GET    | `/code/github-pr-summaries`                         | Bearer        | codeRoutes.ts           | OK     |
| GET    | `/code/worker-settings`                             | Bearer        | workerSettingsRoutes.ts | OK     |
| POST   | `/code/worker-settings/workers`                     | Bearer        | workerSettingsRoutes.ts | OK     |
| PATCH  | `/code/worker-settings/workers/:name`               | Bearer        | workerSettingsRoutes.ts | OK     |
| DELETE | `/code/worker-settings/workers/:name`               | Bearer        | workerSettingsRoutes.ts | OK     |
| POST   | `/code/worker-settings/workers/:name/test`          | Bearer        | workerSettingsRoutes.ts | OK     |
| POST   | `/code/worker-settings/priority`                    | Bearer        | workerSettingsRoutes.ts | OK     |
| POST   | `/internal/code/process`                            | Internal      | codeRoutes.ts           | OK     |
| POST   | `/internal/code/heartbeat`                          | Internal+HMAC | codeRoutes.ts           | OK     |
| POST   | `/internal/code/detect-zombies`                     | Internal      | codeRoutes.ts           | OK     |
| POST   | `/internal/code/cancel-with-nonce`                  | Internal      | codeRoutes.ts           | OK     |
| PATCH  | `/internal/code-tasks/:taskId`                      | Internal      | codeRoutes.ts           | OK     |
| GET    | `/internal/code-tasks/linear/:linearIssueId/active` | Internal      | codeRoutes.ts           | OK     |
| GET    | `/internal/code-tasks/zombies`                      | Internal      | codeRoutes.ts           | OK     |
| POST   | `/internal/tasks/cleanup-logs`                      | OIDC          | codeRoutes.ts           | OK     |
| POST   | `/internal/webhooks/task-complete`                  | Internal+HMAC | webhookRoutes.ts        | OK     |
| POST   | `/internal/logs`                                    | Internal      | webhookRoutes.ts        | OK     |
| POST   | `/internal/turn-metrics`                            | Internal      | webhookRoutes.ts        | OK     |
| POST   | `/webhooks/github`                                  | HMAC          | webhooks/github.ts      | OK     |

### commands-agent

| Method | Path                            | Auth     | Route File        | Status |
| ------ | ------------------------------- | -------- | ----------------- | ------ |
| GET    | `/commands`                     | Bearer   | commandsRoutes.ts | OK     |
| POST   | `/commands`                     | Bearer   | commandsRoutes.ts | OK     |
| DELETE | `/commands/:commandId`          | Bearer   | commandsRoutes.ts | OK     |
| POST   | `/commands/:commandId`          | Bearer   | commandsRoutes.ts | OK     |
| POST   | `/internal/commands`            | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/retry-pending`       | Internal | internalRoutes.ts | OK     |
| GET    | `/internal/commands/:commandId` | Internal | internalRoutes.ts | OK     |

### data-insights-agent

| Method | Path                                                            | Auth     | Route File             | Status |
| ------ | --------------------------------------------------------------- | -------- | ---------------------- | ------ |
| POST   | `/data-sources`                                                 | Bearer   | dataSourceRoutes.ts    | OK     |
| GET    | `/data-sources`                                                 | Bearer   | dataSourceRoutes.ts    | OK     |
| GET    | `/data-sources/:id`                                             | Bearer   | dataSourceRoutes.ts    | OK     |
| PATCH  | `/data-sources/:id`                                             | Bearer   | dataSourceRoutes.ts    | OK     |
| DELETE | `/data-sources/:id`                                             | Bearer   | dataSourceRoutes.ts    | OK     |
| POST   | `/data-sources/generate-title`                                  | Bearer   | dataSourceRoutes.ts    | OK     |
| POST   | `/composite-feeds`                                              | Bearer   | compositeFeedRoutes.ts | OK     |
| GET    | `/composite-feeds`                                              | Bearer   | compositeFeedRoutes.ts | OK     |
| GET    | `/composite-feeds/:id`                                          | Bearer   | compositeFeedRoutes.ts | OK     |
| PATCH  | `/composite-feeds/:id`                                          | Bearer   | compositeFeedRoutes.ts | OK     |
| DELETE | `/composite-feeds/:id`                                          | Bearer   | compositeFeedRoutes.ts | OK     |
| GET    | `/composite-feeds/:id/schema`                                   | Bearer   | compositeFeedRoutes.ts | OK     |
| GET    | `/composite-feeds/:id/data`                                     | Bearer   | compositeFeedRoutes.ts | OK     |
| GET    | `/composite-feeds/:id/snapshot`                                 | Bearer   | compositeFeedRoutes.ts | OK     |
| GET    | `/composite-feeds/:feedId/preview`                              | Bearer   | compositeFeedRoutes.ts | OK     |
| POST   | `/composite-feeds/:feedId/analyze`                              | Bearer   | dataInsightsRoutes.ts  | OK     |
| POST   | `/composite-feeds/:feedId/insights/:insightId/chart-definition` | Bearer   | dataInsightsRoutes.ts  | OK     |
| POST   | `/visualizations`                                               | Bearer   | visualizationRoutes.ts | OK     |
| GET    | `/visualizations`                                               | Bearer   | visualizationRoutes.ts | OK     |
| GET    | `/visualizations/:id`                                           | Bearer   | visualizationRoutes.ts | OK     |
| DELETE | `/visualizations/:id`                                           | Bearer   | visualizationRoutes.ts | OK     |
| POST   | `/visualizations/:id/refresh`                                   | Bearer   | visualizationRoutes.ts | OK     |
| POST   | `/internal/visualizations/compute`                              | Internal | internalRoutes.ts      | OK     |

### image-service

| Method | Path                                | Auth     | Route File        | Status |
| ------ | ----------------------------------- | -------- | ----------------- | ------ |
| POST   | `/internal/images/prompts/generate` | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/images/generate`         | Internal | internalRoutes.ts | OK     |
| DELETE | `/internal/images/:id`              | Internal | internalRoutes.ts | OK     |

### linear-agent

| Method | Path                                           | Auth          | Route File              | Status |
| ------ | ---------------------------------------------- | ------------- | ----------------------- | ------ |
| GET    | `/linear/connection`                           | Bearer        | linearRoutes.ts         | OK     |
| POST   | `/linear/connection/validate`                  | Bearer        | linearRoutes.ts         | OK     |
| POST   | `/linear/connection`                           | Bearer        | linearRoutes.ts         | OK     |
| DELETE | `/linear/connection`                           | Bearer        | linearRoutes.ts         | OK     |
| GET    | `/linear/issues`                               | Bearer        | linearRoutes.ts         | OK     |
| GET    | `/linear/issues/:identifier`                   | Bearer        | linearRoutes.ts         | OK     |
| GET    | `/linear/issues/:identifier/comments`          | Bearer        | linearRoutes.ts         | OK     |
| GET    | `/linear/failed-issues`                        | Bearer        | linearRoutes.ts         | OK     |
| DELETE | `/linear/failed-issues/:id`                    | Bearer        | linearRoutes.ts         | OK     |
| POST   | `/linear/failed-issues/:id/retry`              | Bearer        | linearRoutes.ts         | OK     |
| POST   | `/linear/sync`                                 | Bearer        | linearRoutes.ts         | OK     |
| GET    | `/linear/webhook-config`                       | Bearer        | linearRoutes.ts         | OK     |
| POST   | `/linear/webhook-config`                       | Bearer        | linearRoutes.ts         | OK     |
| DELETE | `/linear/webhook-config`                       | Bearer        | linearRoutes.ts         | OK     |
| POST   | `/linear/webhook`                              | HMAC-SHA256   | linearWebhookRoutes.ts  | OK     |
| POST   | `/internal/linear/process-action`              | Internal      | internalRoutes.ts       | OK     |
| GET    | `/internal/linear/issues/:identifier/validate` | Internal      | internalRoutes.ts       | OK     |
| POST   | `/internal/linear/issues/generate-title`       | Internal      | internalRoutes.ts       | OK     |
| POST   | `/internal/linear/sync`                        | Internal      | internalRoutes.ts       | OK     |
| POST   | `/internal/linear/sync-all`                    | Internal/OIDC | internalRoutes.ts       | OK     |
| POST   | `/internal/issues`                             | Internal      | internalIssuesRoutes.ts | OK     |
| PATCH  | `/internal/issues/:issueId/state`              | Internal      | internalIssuesRoutes.ts | OK     |
| GET    | `/internal/linear/issues/:identifier`          | Internal      | internalIssuesRoutes.ts | ⚠ D2   |

### log-cleanup

Worker runs as Cloud Functions. No HTTP endpoints.

### mobile-notifications-service

| Method | Path                                     | Auth     | Route File                  | Status |
| ------ | ---------------------------------------- | -------- | --------------------------- | ------ |
| POST   | `/mobile-notifications/connect`          | Bearer   | deviceRoutes.ts             | OK     |
| GET    | `/mobile-notifications/status`           | Bearer   | deviceRoutes.ts             | OK     |
| GET    | `/mobile-notifications`                  | Bearer   | notificationRoutes.ts       | OK     |
| DELETE | `/mobile-notifications/:notification_id` | Bearer   | notificationRoutes.ts       | OK     |
| GET    | `/notifications/filters`                 | Bearer   | notificationFilterRoutes.ts | OK     |
| POST   | `/notifications/filters/saved`           | Bearer   | notificationFilterRoutes.ts | OK     |
| DELETE | `/notifications/filters/saved/:id`       | Bearer   | notificationFilterRoutes.ts | OK     |
| POST   | `/mobile-notifications/webhooks`         | HMAC     | webhookRoutes.ts            | OK     |
| POST   | `/internal/mobile-notifications/query`   | Internal | internalRoutes.ts           | OK     |

### notes-agent

| Method | Path              | Auth     | Route File        | Status |
| ------ | ----------------- | -------- | ----------------- | ------ |
| GET    | `/notes`          | Bearer   | noteRoutes.ts     | OK     |
| POST   | `/notes`          | Bearer   | noteRoutes.ts     | OK     |
| GET    | `/notes/:id`      | Bearer   | noteRoutes.ts     | OK     |
| PATCH  | `/notes/:id`      | Bearer   | noteRoutes.ts     | OK     |
| DELETE | `/notes/:id`      | Bearer   | noteRoutes.ts     | OK     |
| POST   | `/internal/notes` | Internal | internalRoutes.ts | OK     |

### notion-service

| Method | Path                                                   | Auth     | Route File           | Status |
| ------ | ------------------------------------------------------ | -------- | -------------------- | ------ |
| POST   | `/notion/connect`                                      | Bearer   | integrationRoutes.ts | OK     |
| GET    | `/notion/status`                                       | Bearer   | integrationRoutes.ts | OK     |
| POST   | `/notion/disconnect`                                   | Bearer   | integrationRoutes.ts | OK     |
| POST   | `/notion-webhooks`                                     | HMAC     | webhookRoutes.ts     | OK     |
| GET    | `/internal/notion/users/:userId/context`               | Internal | internalRoutes.ts    | OK     |
| GET    | `/internal/notion/users/:userId/pages/:pageId/preview` | Internal | internalRoutes.ts    | OK     |

### orchestrator

Worker runs as Cloud Functions. No HTTP endpoints.

### research-agent

| Method | Path                                    | Auth     | Route File        | Status |
| ------ | --------------------------------------- | -------- | ----------------- | ------ |
| POST   | `/internal/research/draft`              | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/llm/pubsub/process-research` | OIDC     | internalRoutes.ts | OK     |
| POST   | `/internal/llm/pubsub/report-analytics` | OIDC     | internalRoutes.ts | OK     |
| POST   | `/internal/llm/pubsub/process-llm-call` | OIDC     | internalRoutes.ts | OK     |

### todos-agent

| Method | Path                                      | Auth     | Route File        | Status |
| ------ | ----------------------------------------- | -------- | ----------------- | ------ |
| GET    | `/todos`                                  | Bearer   | todoRoutes.ts     | OK     |
| POST   | `/todos`                                  | Bearer   | todoRoutes.ts     | OK     |
| GET    | `/todos/:id`                              | Bearer   | todoRoutes.ts     | OK     |
| PATCH  | `/todos/:id`                              | Bearer   | todoRoutes.ts     | OK     |
| DELETE | `/todos/:id`                              | Bearer   | todoRoutes.ts     | OK     |
| POST   | `/todos/:id/items`                        | Bearer   | todoRoutes.ts     | OK     |
| PATCH  | `/todos/:id/items/:itemId`                | Bearer   | todoRoutes.ts     | OK     |
| DELETE | `/todos/:id/items/:itemId`                | Bearer   | todoRoutes.ts     | OK     |
| POST   | `/todos/:id/items/reorder`                | Bearer   | todoRoutes.ts     | OK     |
| POST   | `/todos/:id/archive`                      | Bearer   | todoRoutes.ts     | OK     |
| POST   | `/todos/:id/unarchive`                    | Bearer   | todoRoutes.ts     | OK     |
| POST   | `/todos/:id/cancel`                       | Bearer   | todoRoutes.ts     | OK     |
| POST   | `/internal/todos`                         | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/todos/pubsub/todos-processing` | OIDC     | pubsubRoutes.ts   | OK     |

### user-service

| Method | Path                                                | Auth     | Route File               | Status |
| ------ | --------------------------------------------------- | -------- | ------------------------ | ------ |
| POST   | `/auth/device/start`                                | None     | deviceRoutes.ts          | OK     |
| POST   | `/auth/device/poll`                                 | None     | deviceRoutes.ts          | OK     |
| POST   | `/auth/refresh`                                     | None     | tokenRoutes.ts           | OK     |
| POST   | `/auth/firebase-token`                              | Bearer   | firebaseRoutes.ts        | OK     |
| GET    | `/auth/me`                                          | Bearer   | firebaseRoutes.ts        | OK     |
| POST   | `/auth/oauth/token`                                 | None     | oauthRoutes.ts           | OK     |
| GET    | `/auth/oauth/authorize`                             | None     | oauthRoutes.ts           | OK     |
| GET    | `/auth/config`                                      | None     | configRoutes.ts          | OK     |
| GET    | `/auth/login`                                       | None     | frontendRoutes.ts        | OK     |
| GET    | `/auth/logout`                                      | None     | frontendRoutes.ts        | OK     |
| GET    | `/users/:uid/settings`                              | Bearer   | settingsRoutes.ts        | OK     |
| PATCH  | `/users/:uid/settings`                              | Bearer   | settingsRoutes.ts        | OK     |
| GET    | `/users/:uid/settings/llm-keys`                     | Bearer   | llmKeysRoutes.ts         | OK     |
| PATCH  | `/users/:uid/settings/llm-keys`                     | Bearer   | llmKeysRoutes.ts         | OK     |
| POST   | `/users/:uid/settings/llm-keys/:provider/test`      | Bearer   | llmKeysRoutes.ts         | OK     |
| DELETE | `/users/:uid/settings/llm-keys/:provider`           | Bearer   | llmKeysRoutes.ts         | OK     |
| POST   | `/oauth/connections/google/initiate`                | Bearer   | oauthConnectionRoutes.ts | OK     |
| GET    | `/oauth/connections/google/callback`                | None     | oauthConnectionRoutes.ts | OK     |
| GET    | `/oauth/connections/google/status`                  | Bearer   | oauthConnectionRoutes.ts | OK     |
| DELETE | `/oauth/connections/google`                         | Bearer   | oauthConnectionRoutes.ts | OK     |
| GET    | `/internal/users/:uid/llm-keys`                     | Internal | internalRoutes.ts        | OK     |
| POST   | `/internal/users/:uid/llm-keys/:provider/last-used` | Internal | internalRoutes.ts        | OK     |
| GET    | `/internal/users/:uid/oauth/google/token`           | Internal | internalRoutes.ts        | OK     |
| GET    | `/internal/users/:uid/settings`                     | Internal | internalRoutes.ts        | OK     |

### vm-lifecycle

Worker runs as Cloud Functions. No HTTP endpoints.

### web-agent

| Method | Path                       | Auth     | Route File        | Status |
| ------ | -------------------------- | -------- | ----------------- | ------ |
| POST   | `/internal/link-previews`  | Internal | internalRoutes.ts | OK     |
| POST   | `/internal/page-summaries` | Internal | internalRoutes.ts | OK     |

### whatsapp-service

| Method | Path                                         | Auth   | Route File            | Status |
| ------ | -------------------------------------------- | ------ | --------------------- | ------ |
| GET    | `/whatsapp/webhooks`                         | None   | webhookRoutes.ts      | OK     |
| POST   | `/whatsapp/webhooks`                         | HMAC   | webhookRoutes.ts      | OK     |
| POST   | `/whatsapp/connect`                          | Bearer | mappingRoutes.ts      | OK     |
| GET    | `/whatsapp/status`                           | Bearer | mappingRoutes.ts      | OK     |
| DELETE | `/whatsapp/disconnect`                       | Bearer | mappingRoutes.ts      | OK     |
| GET    | `/whatsapp/messages`                         | Bearer | messageRoutes.ts      | OK     |
| GET    | `/whatsapp/messages/:message_id/media`       | Bearer | messageRoutes.ts      | OK     |
| GET    | `/whatsapp/messages/:message_id/thumbnail`   | Bearer | messageRoutes.ts      | OK     |
| DELETE | `/whatsapp/messages/:message_id`             | Bearer | messageRoutes.ts      | OK     |
| POST   | `/whatsapp/verify/send`                      | Bearer | verificationRoutes.ts | OK     |
| POST   | `/whatsapp/verify/confirm`                   | Bearer | verificationRoutes.ts | OK     |
| GET    | `/whatsapp/verify/status/:phone`             | Bearer | verificationRoutes.ts | OK     |
| POST   | `/internal/whatsapp/pubsub/send-message`     | OIDC   | pubsubRoutes.ts       | OK     |
| POST   | `/internal/whatsapp/pubsub/media-cleanup`    | OIDC   | pubsubRoutes.ts       | OK     |
| POST   | `/internal/whatsapp/pubsub/transcribe-audio` | OIDC   | pubsubRoutes.ts       | OK     |
| POST   | `/internal/whatsapp/pubsub/process-webhook`  | OIDC   | pubsubRoutes.ts       | OK     |

---

## v3 Cross-Service Call Matrix

Internal HTTP calls verified against both caller docs and callee code.

| Caller           | Method | Target Endpoint                                | Callee           | Match |
| ---------------- | ------ | ---------------------------------------------- | ---------------- | ----- |
| orchestrator     | POST   | `/internal/research/draft`                     | research-agent   | OK    |
| orchestrator     | POST   | `/internal/todos`                              | todos-agent      | OK    |
| orchestrator     | POST   | `/internal/notes`                              | notes-agent      | OK    |
| orchestrator     | POST   | `/internal/bookmarks`                          | bookmarks-agent  | OK    |
| orchestrator     | POST   | `/internal/actions`                            | actions-agent    | OK    |
| orchestrator     | POST   | `/internal/calendar/process-action`            | calendar-agent   | OK    |
| orchestrator     | POST   | `/internal/linear/process-action`              | linear-agent     | OK    |
| orchestrator     | POST   | `/internal/code/process`                       | code-agent       | OK    |
| actions-agent    | POST   | `/internal/whatsapp/pubsub/send-message`       | whatsapp-service | OK    |
| actions-agent    | POST   | `/internal/calendar/process-action`            | calendar-agent   | OK    |
| actions-agent    | POST   | `/internal/linear/process-action`              | linear-agent     | OK    |
| actions-agent    | POST   | `/internal/code/process`                       | code-agent       | OK    |
| calendar-agent   | GET    | `/internal/users/:uid/oauth/google/token`      | user-service     | OK    |
| research-agent   | GET    | `/internal/users/:uid/llm-keys`                | user-service     | OK    |
| image-service    | GET    | `/internal/users/:uid/llm-keys`                | user-service     | OK    |
| todos-agent      | GET    | `/internal/users/:uid/llm-keys`                | user-service     | OK    |
| linear-agent     | GET    | `/internal/users/:uid/llm-keys`                | user-service     | OK    |
| bookmarks-agent  | POST   | `/internal/link-previews`                      | web-agent        | OK    |
| whatsapp-service | POST   | `/internal/images/generate`                    | image-service    | OK    |
| code-agent       | GET    | `/internal/linear/issues/:identifier/validate` | linear-agent     | OK    |
| code-agent       | POST   | `/internal/linear/issues/generate-title`       | linear-agent     | OK    |
| code-agent       | PATCH  | `/internal/issues/:issueId/state`              | linear-agent     | OK    |
| code-agent       | POST   | `/internal/issues`                             | linear-agent     | OK    |
| code-agent       | PATCH  | `/internal/actions/:actionId/status`           | actions-agent    | ⚠ D1  |
| code-agent       | GET    | `/internal/notion/users/:userId/context`       | notion-service   | OK    |
| code-agent       | POST   | `/internal/mobile-notifications/query`         | mobile-notif.    | OK    |
| various services | GET    | `/settings/pricing`                            | app-settings     | OK    |

---

## v3 Discrepancies

### D1 — actions-agent: Undocumented PATCH status endpoint

| Field     | Value                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity  | **HIGH**                                                                                                                                             |
| Service   | actions-agent                                                                                                                                        |
| Type      | Undocumented endpoint (exists in code, absent from docs table)                                                                                       |
| Method    | `PATCH`                                                                                                                                              |
| Path      | `/internal/actions/:actionId/status`                                                                                                                 |
| Code file | `apps/actions-agent/src/routes/internalRoutes.ts`                                                                                                    |
| Auth      | X-Internal-Auth                                                                                                                                      |
| Body      | `{ resource_status: 'dispatched' \                                                                                                                   | 'running' \ | 'completed' \ | 'failed' \ | 'cancelled', resource_result?: { prUrl?: string; error?: string } }` |
| Purpose   | Updates action resource status — used as a callback by code-agent to report task lifecycle events                                                    |
| Risk      | code-agent calls this endpoint in production; if actions-agent changes the path or body schema, there is no doc contract to signal a breaking change |
| Fix       | Add to Internal Endpoints table in `docs/services/actions-agent/technical.md`                                                                        |

### D2 — linear-agent: Undocumented internal GET issue endpoint

| Field          | Value                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity       | **HIGH**                                                                                                                                                 |
| Service        | linear-agent                                                                                                                                             |
| Type           | Undocumented endpoint (exists in code, absent from docs table)                                                                                           |
| Method         | `GET`                                                                                                                                                    |
| Path           | `/internal/linear/issues/:identifier`                                                                                                                    |
| Code file      | `apps/linear-agent/src/routes/internalIssuesRoutes.ts` (operationId: `getLinearIssueInternal`)                                                           |
| Auth           | X-Internal-Auth                                                                                                                                          |
| Purpose        | Fetches a Linear issue with full detail + comment count for internal service consumption — distinct from the public `GET /linear/issues/:identifier`     |
| Confusion risk | The docs table lists `GET /internal/linear/issues/:identifier/validate` — the plain GET at the same base path is easy to miss or confuse with that entry |
| Risk           | Invisible coupling between services. Path is easily confused with the documented `/validate` variant.                                                    |
| Fix            | Add to Internal Endpoints table in `docs/services/linear-agent/technical.md`                                                                             |

---

## v3 Action Items

| Priority | Action                                                                                                              | File                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| HIGH     | Add `PATCH /internal/actions/:actionId/status` to actions-agent Internal Endpoints table                            | `docs/services/actions-agent/technical.md` |
| HIGH     | Add `GET /internal/linear/issues/:identifier` to linear-agent Internal Endpoints table                              | `docs/services/linear-agent/technical.md`  |
| LOW      | Identify which service(s) call `GET /internal/linear/issues/:identifier` (internal) and add to cross-service matrix | Engineering investigation                  |

---

## v3 Validation Notes

- **Workers excluded from endpoint count**: claude-worker, log-cleanup, orchestrator, and vm-lifecycle run as Cloud Functions and have no HTTP endpoints — they are event-driven via Cloud Events / Pub/Sub.
- **Pub/Sub push endpoint auth**: All OIDC-authenticated push handlers are authenticated at the Cloud Run infrastructure level. The `From: noreply@google.com` header is a secondary signal for logging, not the primary auth mechanism.
- **Dual-auth endpoints**: Endpoints marked `Internal/OIDC` accept both Cloud Scheduler OIDC tokens and X-Internal-Auth headers for flexibility.
- **`GET /images/proxy` in bookmarks-agent**: `None` auth is intentional — this endpoint proxies external images for bookmark card display in the web UI.
- **`GET /oauth/connections/google/callback`**: Uses `None` auth because the redirect comes from Google's servers; state validation happens via OAuth `code` + `state` parameters.
- **`POST /auth/oauth/token` and `GET /auth/oauth/authorize`**: Use `@allow-raw-send` because OAuth2 spec requires flat `{ error, error_description }` responses — documented exceptions to the response contract rule.
- **app-settings-service `/settings/pricing`**: Registered as two separate handlers (public unauthenticated, and internal with X-Internal-Auth) in different route files, same path prefix but different scopes.
- **v3 vs v2 comparison**: The Feb 08 report found D6/D7 (code-agent path mismatches) and D5 (3 missing linear-agent endpoints). All three were fixed in documentation updates. Only D1 (actions-agent status callback) and D2 (linear-agent internal GET) remain open.

---

## Historical Report (2026-02-08)

> The following sections preserve the original v2 report for reference. All findings marked FAIL or HIGH in that report have been addressed except D4 (now D1 above) and part of D5 (now D2 above).

---

---

## 1. Cross-Service Call Validation

This table tracks every documented cross-service HTTP call, verifying the caller's documentation against the callee's documentation and actual code.

### user-service (Callee)

| Caller         | Documented Path (Caller Docs)            | Callee Docs Path                          | Actual Code Path                          | Match |
| -------------- | ---------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----- |
| research-agent | `/internal/users/{id}/llm-keys`          | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |
| research-agent | `/internal/users/{id}/settings`          | `/internal/users/:uid/settings`           | `/internal/users/:uid/settings`           | OK    |
| web-agent      | `/internal/users/{id}/settings`          | `/internal/users/:uid/settings`           | `/internal/users/:uid/settings`           | OK    |
| web-agent      | `/internal/users/{id}/llm-keys`          | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |
| calendar-agent | `/internal/users/:id/oauth/google/token` | `/internal/users/:uid/oauth/google/token` | `/internal/users/:uid/oauth/google/token` | OK    |
| calendar-agent | `/internal/users/:id/llm-client`         | N/A (does not exist)                      | N/A (does not exist)                      | FAIL  |
| todos-agent    | `/internal/users/:userId/llm-client`     | N/A (does not exist)                      | N/A (does not exist)                      | FAIL  |
| image-service  | `/internal/users/:userId/api-keys`       | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | FAIL  |
| linear-agent   | `/internal/user/llm-client`              | N/A (does not exist)                      | N/A (does not exist)                      | FAIL  |
| chat-agent     | (via `@intexuraos/internal-clients`)     | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |
| commands-agent | (via `@intexuraos/internal-clients`)     | `/internal/users/:uid/llm-keys`           | `/internal/users/:uid/llm-keys`           | OK    |

**Details on FAIL cases:**

1. **calendar-agent docs reference `/internal/users/:id/llm-client`** -- This endpoint does not exist in user-service. The actual mechanism is the `@intexuraos/internal-clients` package which calls `/internal/users/:uid/llm-keys` and `/internal/users/:uid/settings` to build an LLM client. The docs incorrectly describe this as a single endpoint.

2. **todos-agent docs reference `/internal/users/:userId/llm-client`** -- Same issue. The actual internal-clients package calls two separate user-service endpoints.

3. **image-service docs reference `/internal/users/:userId/api-keys`** -- The actual endpoint is `/internal/users/:uid/llm-keys`. The path `api-keys` does not exist.

4. **linear-agent docs reference `/internal/user/llm-client`** -- This is doubly wrong: the path segment is `users` not `user`, and `llm-client` is not a real endpoint. Same internal-clients pattern as above.

### actions-agent (Callee)

| Caller         | Documented Path (Caller Docs)              | Callee Docs Path         | Actual Code Path                           | Match |
| -------------- | ------------------------------------------ | ------------------------ | ------------------------------------------ | ----- |
| commands-agent | `POST /internal/actions`                   | `POST /internal/actions` | `POST /internal/actions`                   | OK    |
| code-agent     | `PATCH /internal/actions/:actionId/status` | N/A (not in docs table)  | `PATCH /internal/actions/:actionId/status` | WARN  |

**Detail:** The `PATCH /internal/actions/:actionId/status` endpoint exists in code but is NOT listed in the actions-agent technical.md Internal Endpoints table.

### web-agent (Callee)

| Caller          | Documented Path (Caller Docs)    | Callee Docs Path                | Actual Code Path                | Match |
| --------------- | -------------------------------- | ------------------------------- | ------------------------------- | ----- |
| bookmarks-agent | `POST /internal/link-previews`   | `POST /internal/link-previews`  | `POST /internal/link-previews`  | OK    |
| bookmarks-agent | `POST /internal/page-summaries`  | `POST /internal/page-summaries` | `POST /internal/page-summaries` | OK    |
| research-agent  | (architecture diagram reference) | `POST /internal/page-summaries` | `POST /internal/page-summaries` | OK    |

### linear-agent (Callee)

| Caller        | Documented Path (Caller Docs)           | Callee Docs Path                        | Actual Code Path                        | Match |
| ------------- | --------------------------------------- | --------------------------------------- | --------------------------------------- | ----- |
| actions-agent | `POST /internal/linear/process-action`  | `POST /internal/linear/process-action`  | `POST /internal/linear/process-action`  | OK    |
| code-agent    | `POST /internal/issues`                 | `POST /internal/issues`                 | `POST /internal/issues`                 | OK    |
| code-agent    | `PATCH /internal/issues/:issueId/state` | `PATCH /internal/issues/:issueId/state` | `PATCH /internal/issues/:issueId/state` | OK    |

### research-agent (Callee)

| Caller        | Documented Path (Caller Docs)   | Callee Docs Path                | Actual Code Path                | Match |
| ------------- | ------------------------------- | ------------------------------- | ------------------------------- | ----- |
| actions-agent | `POST /internal/research/draft` | `POST /internal/research/draft` | `POST /internal/research/draft` | OK    |

### image-service (Callee)

| Caller         | Documented Path (Caller Docs)            | Callee Docs Path                         | Actual Code Path                         | Match |
| -------------- | ---------------------------------------- | ---------------------------------------- | ---------------------------------------- | ----- |
| research-agent | `POST /internal/images/generate`         | `POST /internal/images/generate`         | `POST /internal/images/generate`         | OK    |
| research-agent | `POST /internal/images/prompts/generate` | `POST /internal/images/prompts/generate` | `POST /internal/images/prompts/generate` | OK    |
| research-agent | `DELETE /internal/images/:id`            | `DELETE /internal/images/:id`            | `DELETE /internal/images/:id`            | OK    |

### app-settings-service (Callee)

| Caller       | Documented Path (Caller Docs) | Callee Docs Path                         | Actual Code Path             | Match |
| ------------ | ----------------------------- | ---------------------------------------- | ---------------------------- | ----- |
| linear-agent | `/internal/pricing`           | `/internal/pricing/:provider` (agent.md) | `/internal/settings/pricing` | FAIL  |

**Detail:** The linear-agent docs say the app-settings-service endpoint is `/internal/pricing`, but the actual code has `/internal/settings/pricing`. The path prefix `/internal/settings/` is part of the actual route.

### code-agent (Callee)

| Caller        | Documented Path (Caller Docs)                   | Callee Docs Path                        | Actual Code Path                        | Match |
| ------------- | ----------------------------------------------- | --------------------------------------- | --------------------------------------- | ----- |
| actions-agent | `POST /internal/code/process` (from deps table) | `POST /internal/code/process`           | `POST /internal/code/process`           | OK    |
| orchestrator  | `POST /internal/logs`                           | `POST /internal/logs`                   | `POST /internal/logs`                   | OK    |
| orchestrator  | `POST /internal/webhooks/task-complete`         | `POST /internal/webhooks/task-complete` | `POST /internal/webhooks/task-complete` | OK    |
| orchestrator  | `POST /internal/code/heartbeat`                 | `POST /internal/code/heartbeat`         | `POST /internal/code/heartbeat`         | OK    |

---

## 2. Docs vs Code Endpoint Mismatch

### 2.1 Endpoints in Code but NOT in Docs

| Service       | Method | Actual Code Path                         | Description                                         |
| ------------- | ------ | ---------------------------------------- | --------------------------------------------------- |
| actions-agent | PATCH  | `/internal/actions/:actionId/status`     | Update action resource status (code-agent callback) |
| linear-agent  | GET    | `/internal/linear/issues/:identifier`    | Validate a Linear issue exists                      |
| linear-agent  | POST   | `/internal/linear/issues/generate-title` | LLM-powered title generation                        |
| linear-agent  | POST   | `/internal/linear/sync`                  | Full sync of Linear issues for a user               |
| code-agent    | POST   | `/internal/code/cancel-with-nonce`       | Cancel task via WhatsApp nonce                      |
| code-agent    | POST   | `/internal/tasks/cleanup-logs`           | Cleanup old task logs                               |

**Note on linear-agent:** The `internalRoutes.ts` contains 4 endpoints (`/internal/linear/process-action`, `/internal/linear/issues/:identifier`, `/internal/linear/issues/generate-title`, `/internal/linear/sync`) but the docs table only lists `POST /internal/linear/process-action`. The other three are described in use case sections but omitted from the Internal Endpoints table.

### 2.2 Endpoints in Docs but Path Differs in Code

| Service    | Docs Path                          | Actual Code Path                        | Issue                                    |
| ---------- | ---------------------------------- | --------------------------------------- | ---------------------------------------- |
| code-agent | `POST /internal/code/cancel`       | `POST /internal/code/cancel-with-nonce` | Path name differs (nonce suffix in code) |
| code-agent | `POST /internal/code/cleanup-logs` | `POST /internal/tasks/cleanup-logs`     | Path prefix differs (`code` vs `tasks`)  |

---

## 3. Complete Internal Endpoint Registry

### actions-agent

| Method | Path                                 | Docs | Code |
| ------ | ------------------------------------ | ---- | ---- |
| POST   | `/internal/actions`                  | Yes  | Yes  |
| POST   | `/internal/actions/:actionType`      | Yes  | Yes  |
| POST   | `/internal/actions/process`          | Yes  | Yes  |
| POST   | `/internal/actions/retry-pending`    | Yes  | Yes  |
| POST   | `/internal/actions/approval-reply`   | Yes  | Yes  |
| PATCH  | `/internal/actions/:actionId/status` | No   | Yes  |

### research-agent

| Method | Path                                    | Docs | Code |
| ------ | --------------------------------------- | ---- | ---- |
| POST   | `/internal/research/draft`              | Yes  | Yes  |
| POST   | `/internal/llm/pubsub/process-research` | Yes  | Yes  |
| POST   | `/internal/llm/pubsub/process-llm-call` | Yes  | Yes  |
| POST   | `/internal/llm/pubsub/report-analytics` | Yes  | Yes  |

### commands-agent

| Method | Path                            | Docs | Code |
| ------ | ------------------------------- | ---- | ---- |
| POST   | `/internal/commands`            | Yes  | Yes  |
| POST   | `/internal/retry-pending`       | Yes  | Yes  |
| GET    | `/internal/commands/:commandId` | Yes  | Yes  |

### whatsapp-service

| Method | Path                                         | Docs | Code |
| ------ | -------------------------------------------- | ---- | ---- |
| POST   | `/internal/whatsapp/pubsub/process-webhook`  | Yes  | Yes  |
| POST   | `/internal/whatsapp/pubsub/transcribe-audio` | Yes  | Yes  |
| POST   | `/internal/whatsapp/pubsub/send-message`     | Yes  | Yes  |
| POST   | `/internal/whatsapp/pubsub/media-cleanup`    | Yes  | Yes  |

### user-service

| Method | Path                                                | Docs | Code |
| ------ | --------------------------------------------------- | ---- | ---- |
| GET    | `/internal/users/:uid/llm-keys`                     | Yes  | Yes  |
| POST   | `/internal/users/:uid/llm-keys/:provider/last-used` | Yes  | Yes  |
| GET    | `/internal/users/:uid/oauth/google/token`           | Yes  | Yes  |
| GET    | `/internal/users/:uid/settings`                     | Yes  | Yes  |

### web-agent

| Method | Path                       | Docs | Code |
| ------ | -------------------------- | ---- | ---- |
| POST   | `/internal/link-previews`  | Yes  | Yes  |
| POST   | `/internal/page-summaries` | Yes  | Yes  |

### bookmarks-agent

| Method | Path                                    | Docs | Code |
| ------ | --------------------------------------- | ---- | ---- |
| POST   | `/internal/bookmarks`                   | Yes  | Yes  |
| GET    | `/internal/bookmarks/:id`               | Yes  | Yes  |
| PATCH  | `/internal/bookmarks/:id`               | Yes  | Yes  |
| POST   | `/internal/bookmarks/:id/force-refresh` | Yes  | Yes  |
| POST   | `/internal/bookmarks/pubsub/enrich`     | Yes  | Yes  |
| POST   | `/internal/bookmarks/pubsub/summarize`  | Yes  | Yes  |

### todos-agent

| Method | Path                                      | Docs | Code |
| ------ | ----------------------------------------- | ---- | ---- |
| POST   | `/internal/todos`                         | Yes  | Yes  |
| POST   | `/internal/todos/pubsub/todos-processing` | Yes  | Yes  |

### calendar-agent

| Method | Path                                   | Docs | Code |
| ------ | -------------------------------------- | ---- | ---- |
| POST   | `/internal/calendar/process-action`    | Yes  | Yes  |
| POST   | `/internal/calendar/generate-preview`  | Yes  | Yes  |
| GET    | `/internal/calendar/preview/:actionId` | Yes  | Yes  |

### image-service

| Method | Path                                | Docs | Code |
| ------ | ----------------------------------- | ---- | ---- |
| POST   | `/internal/images/prompts/generate` | Yes  | Yes  |
| POST   | `/internal/images/generate`         | Yes  | Yes  |
| DELETE | `/internal/images/:id`              | Yes  | Yes  |

### linear-agent

| Method | Path                                     | Docs Table | Code |
| ------ | ---------------------------------------- | ---------- | ---- |
| POST   | `/internal/linear/process-action`        | Yes        | Yes  |
| POST   | `/internal/issues`                       | Yes        | Yes  |
| PATCH  | `/internal/issues/:issueId/state`        | Yes        | Yes  |
| GET    | `/internal/linear/issues/:identifier`    | No         | Yes  |
| POST   | `/internal/linear/issues/generate-title` | No         | Yes  |
| POST   | `/internal/linear/sync`                  | No         | Yes  |

### notes-agent

| Method | Path              | Docs | Code |
| ------ | ----------------- | ---- | ---- |
| POST   | `/internal/notes` | Yes  | Yes  |

### code-agent

| Method | Path                                                | Docs | Code |
| ------ | --------------------------------------------------- | ---- | ---- |
| POST   | `/internal/code/process`                            | Yes  | Yes  |
| PATCH  | `/internal/code-tasks/:taskId`                      | Yes  | Yes  |
| GET    | `/internal/code-tasks/linear/:linearIssueId/active` | Yes  | Yes  |
| GET    | `/internal/code-tasks/zombies`                      | Yes  | Yes  |
| POST   | `/internal/code/cancel-with-nonce`                  | No\* | Yes  |
| POST   | `/internal/code/heartbeat`                          | Yes  | Yes  |
| POST   | `/internal/code/detect-zombies`                     | Yes  | Yes  |
| POST   | `/internal/tasks/cleanup-logs`                      | No\* | Yes  |
| POST   | `/internal/webhooks/task-complete`                  | Yes  | Yes  |
| POST   | `/internal/logs`                                    | Yes  | Yes  |
| POST   | `/webhooks/github`                                  | Yes  | Yes  |

\*Documented with different paths: `/internal/code/cancel` and `/internal/code/cleanup-logs`

### notion-service (not in original scope but referenced)

| Method | Path                                                   | Docs | Code |
| ------ | ------------------------------------------------------ | ---- | ---- |
| GET    | `/internal/notion/users/:userId/context`               | N/A  | Yes  |
| GET    | `/internal/notion/users/:userId/pages/:pageId/preview` | N/A  | Yes  |

### app-settings-service (not in original scope but referenced)

| Method | Path                         | Docs | Code |
| ------ | ---------------------------- | ---- | ---- |
| GET    | `/internal/settings/pricing` | N/A  | Yes  |

---

## 4. Discrepancy Details

### D1: Phantom `/llm-client` Endpoint in 3 Service Docs

**Affected docs:** `calendar-agent/technical.md`, `todos-agent/technical.md`, `linear-agent/technical.md`

**Problem:** These docs list a dependency endpoint `/internal/users/:id/llm-client` (or variants) on user-service. This endpoint does not exist. The actual mechanism is the `@intexuraos/internal-clients` package, which composes an LLM client by calling:

1. `GET /internal/users/:uid/settings` (to get default model preference)
2. `GET /internal/users/:uid/llm-keys` (to get decrypted API keys)

**Impact:** Low (code works correctly via the package, docs are just misleading). Developers consulting only the docs would not find this endpoint.

**Fix:** Update the Dependencies section of these three technical.md files to reference the two actual endpoints, or note that the `@intexuraos/internal-clients` package handles the interaction.

### D2: Wrong Path `/internal/users/:userId/api-keys` in image-service Docs

**File:** `docs/services/image-service/technical.md` line 171

**Problem:** Docs say image-service calls `/internal/users/:userId/api-keys` on user-service. The actual endpoint is `/internal/users/:uid/llm-keys`.

**Impact:** Low (code works via internal-clients). Documentation is incorrect.

**Fix:** Change `api-keys` to `llm-keys` in the Dependencies table.

### D3: Wrong Path `/internal/pricing` in linear-agent Docs

**File:** `docs/services/linear-agent/technical.md` line 634

**Problem:** Docs say linear-agent calls `/internal/pricing` on app-settings-service. The actual endpoint is `/internal/settings/pricing`.

**Impact:** Low. Path prefix mismatch.

**Fix:** Update to `/internal/settings/pricing`.

### D4: Missing `PATCH /internal/actions/:actionId/status` in actions-agent Docs

**File:** `docs/services/actions-agent/technical.md`

**Problem:** The Internal Endpoints table omits this endpoint, which is used by code-agent to update action resource status (dispatched, running, completed, failed, cancelled).

**Impact:** Medium. code-agent developers would not know this endpoint exists by reading the actions-agent docs alone.

**Fix:** Add `PATCH /internal/actions/:actionId/status` to the Internal Endpoints table with description "Update action resource status from code-agent".

### D5: Missing 3 Internal Endpoints in linear-agent Docs Table

**File:** `docs/services/linear-agent/technical.md`

**Problem:** The Internal Endpoints table lists only `POST /internal/linear/process-action`, `POST /internal/issues`, and `PATCH /internal/issues/:issueId/state`. The following endpoints exist in code but are not in the table:

- `GET /internal/linear/issues/:identifier` (validate issue)
- `POST /internal/linear/issues/generate-title` (generate title)
- `POST /internal/linear/sync` (full sync)

These are described in the "New Routes" section text and use case descriptions but not in the Internal Endpoints table.

**Impact:** Medium. Callers (like code-agent) may not discover these endpoints from the endpoint table.

**Fix:** Add these three endpoints to the Internal Endpoints table.

### D6: Path Mismatch for code-agent Cancel Endpoint

**File:** `docs/services/code-agent/technical.md`

**Problem:** Docs list `POST /internal/code/cancel` but actual code path is `POST /internal/code/cancel-with-nonce`.

**Impact:** High. Any service trying to call `/internal/code/cancel` based on docs would get a 404.

**Fix:** Update docs to show `/internal/code/cancel-with-nonce`.

### D7: Path Mismatch for code-agent Cleanup Logs Endpoint

**File:** `docs/services/code-agent/technical.md`

**Problem:** Docs list `POST /internal/code/cleanup-logs` but actual code path is `POST /internal/tasks/cleanup-logs`.

**Impact:** High. Any service or cron trying to call `/internal/code/cleanup-logs` based on docs would get a 404.

**Fix:** Update docs to show `/internal/tasks/cleanup-logs`.

---

## 5. Services Not Requiring Internal HTTP Validation

The following services from the analyzed set have no cross-service HTTP discrepancies:

- **whatsapp-service** -- All 4 Pub/Sub handler endpoints match between docs and code
- **notes-agent** -- Single `/internal/notes` endpoint matches
- **research-agent** -- All 4 endpoints match between docs and code
- **commands-agent** -- All 3 endpoints match between docs and code
- **bookmarks-agent** -- All 6 endpoints match between docs and code
- **calendar-agent** -- All 3 endpoints match between docs and code (caller-side docs issue only)
- **web-agent** -- Both endpoints match between docs and code
- **image-service** -- All 3 endpoints match between docs and code (caller-side docs issue only)
- **chat-agent** -- No internal endpoints (public only, verified)
- **orchestrator** -- Not a Cloud Run service; HTTP contract with code-agent verified

---

## 6. Priority Fix List

| Priority | Discrepancy | Files to Update                                              |
| -------- | ----------- | ------------------------------------------------------------ |
| HIGH     | D6          | `docs/services/code-agent/technical.md`                      |
| HIGH     | D7          | `docs/services/code-agent/technical.md`                      |
| MEDIUM   | D4          | `docs/services/actions-agent/technical.md`                   |
| MEDIUM   | D5          | `docs/services/linear-agent/technical.md`                    |
| LOW      | D1          | `calendar-agent`, `todos-agent`, `linear-agent` technical.md |
| LOW      | D2          | `docs/services/image-service/technical.md`                   |
| LOW      | D3          | `docs/services/linear-agent/technical.md`                    |
