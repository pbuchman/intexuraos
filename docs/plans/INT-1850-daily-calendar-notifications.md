# Daily Calendar Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Let users enable a once-daily calendar lookahead notification from the Calendar settings page. At the configured 15-minute interval, IntexuraOS sends a user-authored Matrix message into the WhatsApp/Intex Agent conversation to open a new assistant session and ask for events in the next 24 hours.

The scheduled message text must be:

```text
new session: Send me events that they have in the calendar in the next 24 hours.
```

The `new session:` prefix is required so the existing Intex Agent session command path starts a fresh assistant session.

## Architecture

Calendar Agent owns the generic schedule domain, schedule persistence, and the 15-minute scheduler tick. A due `calendar_daily_lookahead` schedule calls a new WhatsApp Service internal Matrix outbound gateway. WhatsApp Service owns private WhatsApp/Matrix account resolution and calls the Matrix adapter running on the external machine. The Matrix adapter sends a Matrix `m.room.message` as the user into the configured WhatsApp/Intex Agent portal room. The existing private WhatsApp sync and Intex Agent ingestion path then handles the user-authored message and returns the assistant response through the current WhatsApp path.

Do not use the existing `whatsapp.message.send` Pub/Sub event for the scheduled prompt. That event sends from the WhatsApp business account, but this feature must send as the user to refresh the 24-hour WhatsApp conversation window.

Do not bypass Matrix by calling `POST /internal/intex-agent/messages` for the scheduled prompt. That would create assistant work but would not produce the user-originated WhatsApp/Matrix message required to reopen the WhatsApp window.

## Key Decisions

- Use PLAN-DOC because the work spans Calendar Agent domain, backend scheduler infrastructure, WhatsApp Service, Matrix adapter changes, web settings UI, Firestore, Terraform, and setup documentation.
- Store reusable schedules in Calendar Agent so future scheduled calendar tasks can reuse the same domain and tick processor.
- Keep Matrix credentials out of the web app. The Calendar settings page displays delivery readiness and setup requirements, but never exposes Matrix access tokens or outbound adapter secrets.
- Add a Matrix outbound API to the private WhatsApp Matrix adapter because that adapter currently mirrors Matrix messages into IntexuraOS but does not provide an IntexuraOS-to-Matrix send path.

## Endpoint Changes

### Created

- `GET /schedules/calendar-daily-lookahead` in Calendar Agent, authenticated with the existing user auth, returns the current user's schedule and Matrix delivery readiness.
- `PUT /schedules/calendar-daily-lookahead` in Calendar Agent, authenticated with the existing user auth, enables, disables, or updates the current user's daily lookahead schedule.
- `POST /internal/calendar/schedules/tick` in Calendar Agent, authenticated with `authenticateInternalScheduler`, claims and processes due schedules. The route must accept an empty body.
- `GET /internal/whatsapp/private/matrix-delivery-status/:userId` in WhatsApp Service, authenticated with internal auth, reports whether the user has an active private Matrix account and outbound Matrix target configured.
- `POST /internal/whatsapp/private/outbound-matrix-messages` in WhatsApp Service, authenticated with internal auth, resolves the user's private Matrix account and asks the Matrix adapter to send a user-authored message.
- `GET /internal/matrix/outbound/readiness/:sourceAccountId/:target` in `tools/whatsapp-private-matrix-sync`, authenticated with an adapter-local token, checks whether the configured source account and outbound target mapping can deliver without sending a Matrix event.
- `POST /internal/matrix/outbound/messages` in `tools/whatsapp-private-matrix-sync`, authenticated with an adapter-local token, sends a Matrix text event into the configured room.

### Modified

- `/settings/calendar` web page to add the daily notification card and Matrix setup status.
- `tools/whatsapp-private-matrix-sync` configuration and README to document outbound Matrix delivery.
- Calendar Agent, WhatsApp Service, and deployment configuration for new service URLs and secrets.
- Hetzner scheduler and internal route-owner Terraform so the production 15-minute tick reaches Calendar Agent through the public `intexuraos.cloud` route.

### Unchanged

- `POST /internal/intex-agent/messages`; the feature relies on existing Intex Agent session command behavior after Matrix ingestion.
- Existing calendar event query and action-processing endpoints.
- Existing `whatsapp.message.send` business-account Pub/Sub publisher.

## Data Model

Create Calendar Agent owned Firestore collections:

- `calendar_schedules`
- `calendar_schedule_runs`

Register both collections in `firestore-collections.json` and add required indexes through a new migration. The repository currently has a tracked `migrations/119_private-whatsapp-reaction-target-index.mjs` while `migrations/manifest.json` still reports `lastReservedId` as `118`; execution must reconcile the manifest first and then reserve the next migration ID, expected to be `120_calendar-schedules-indexes.mjs`.

```ts
export type CalendarScheduleTaskType = 'calendar_daily_lookahead';
export type CalendarScheduleStatus = 'active' | 'paused';

export interface CalendarSchedule {
  id: string; // `${userId}_${taskType}`
  userId: string;
  taskType: CalendarScheduleTaskType;
  status: CalendarScheduleStatus;
  cadence: {
    type: 'daily';
    localTime: string; // HH:mm, minute must be 00, 15, 30, or 45
    timeZone: string; // IANA timezone
  };
  payload: {
    prompt: string;
    target: 'intex_agent';
  };
  nextRunAt: string;
  lastRunAt?: string;
  lastRunLocalDate?: string;
  lease?: {
    ownerId: string;
    expiresAt: string;
  };
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export interface CalendarScheduleRun {
  id: string; // `${schedule.id}_${localDate}`
  scheduleId: string;
  userId: string;
  taskType: CalendarScheduleTaskType;
  status: 'leased' | 'sent' | 'failed';
  localDate: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt?: string;
  matrixEventId?: string;
  error?: string;
}
```

Indexes:

- `calendar_schedules`: `status ASC, nextRunAt ASC`
- `calendar_schedules`: `userId ASC, taskType ASC`
- `calendar_schedule_runs`: `scheduleId ASC, startedAt DESC`
- `calendar_schedule_runs`: `userId ASC, startedAt DESC`

## Calendar Agent Files

- `apps/calendar-agent/src/domain/schedules/types.ts`
- `apps/calendar-agent/src/domain/schedules/scheduleTime.ts`
- `apps/calendar-agent/src/domain/schedules/scheduleRepository.ts`
- `apps/calendar-agent/src/domain/schedules/getDailyLookaheadSchedule.ts`
- `apps/calendar-agent/src/domain/schedules/upsertDailyLookaheadSchedule.ts`
- `apps/calendar-agent/src/domain/schedules/runDueSchedules.ts`
- `apps/calendar-agent/src/infra/firestore/calendarScheduleRepository.ts`
- `apps/calendar-agent/src/routes/scheduleRoutes.ts`
- `apps/calendar-agent/src/routes/internalScheduleRoutes.ts`
- `apps/calendar-agent/src/services.ts`
- `apps/calendar-agent/src/server.ts`
- `apps/calendar-agent/src/index.ts`
- `apps/calendar-agent/src/__tests__/fakes.ts`
- `apps/calendar-agent/src/__tests__/routes/scheduleRoutes.test.ts`
- `apps/calendar-agent/src/__tests__/routes/internalScheduleRoutes.test.ts`

## WhatsApp Service Files

- `apps/whatsapp-service/src/domain/whatsapp/ports/matrixOutboundGateway.ts`
- `apps/whatsapp-service/src/infra/http/matrixOutboundAdapterClient.ts`
- `apps/whatsapp-service/src/routes/privateMatrixOutboundRoutes.ts`
- `apps/whatsapp-service/src/routes/index.ts`
- `apps/whatsapp-service/src/routes/routes.ts`
- `apps/whatsapp-service/src/services.ts`
- `apps/whatsapp-service/src/server.ts`
- `apps/whatsapp-service/src/index.ts`
- `apps/whatsapp-service/src/__tests__/routes/privateMatrixOutboundRoutes.test.ts`

## Internal Client Files

- `packages/internal-clients/src/whatsapp-service/types.ts`
- `packages/internal-clients/src/whatsapp-service/client.ts`
- `packages/internal-clients/src/whatsapp-service/index.ts`
- `packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts`
- `packages/internal-clients/src/index.ts`

## Matrix Adapter Files

- `tools/whatsapp-private-matrix-sync/src/server.mjs`
- `tools/whatsapp-private-matrix-sync/src/server.test.mjs`
- `tools/whatsapp-private-matrix-sync/README.md`
- `docs/setup/16-private-whatsapp-matrix-sync.md`

The Matrix adapter should load outbound target mappings from configuration on the Matrix host, for example:

```json
{
  "<sourceAccountId>": {
    "intex_agent": "!roomid:home-dev"
  }
}
```

Use an adapter-local secret such as `MATRIX_OUTBOUND_AUTH_TOKEN_FILE` and a mapping path such as `MATRIX_OUTBOUND_TARGETS_FILE`. The exact names can be adjusted during implementation if the adapter already has a stronger local convention, but they must be documented in the setup guide and wired through deployment configuration.

The adapter readiness endpoint must use the same target resolution code as the send endpoint and return only configuration status, not credentials or room IDs. Expected responses:

- `{ status: 'ready' }` when `sourceAccountId` exists and the requested target, currently `intex_agent`, maps to a sendable room.
- `{ status: 'setup_required', reason }` when the source account is unknown, the target is missing, the mapping file is absent, or the Matrix client cannot be initialized.

WhatsApp Service `GET /internal/whatsapp/private/matrix-delivery-status/:userId` must call this readiness endpoint after resolving the user's active private Matrix account. The Calendar settings card must treat readiness as deliverable only when the adapter returns `ready`, so the UI cannot claim delivery is configured based solely on a local private account record.

## Web Files

- `apps/web/src/components/calendar/CalendarDailyNotificationCard.tsx`
- `apps/web/src/pages/GoogleCalendarConnectionPage.tsx`
- `apps/web/src/services/calendarApi.ts`
- `apps/web/src/types/index.ts`
- Relevant web tests next to the existing calendar settings/page tests.

The Calendar settings card must include:

- Enable/disable toggle.
- Time selector with every `HH:mm` option in 15-minute increments.
- Timezone display or selector defaulting to the browser/user timezone.
- Save, saving, saved, and error states consistent with the current settings UI.
- Delivery status from the backend.
- A clear setup message when Matrix outbound delivery is not configured. This message must explain that the Matrix host needs the outbound adapter endpoint, token, and target room mapping before scheduled notifications can be delivered.

## Infrastructure And Config

- Add Calendar Agent dependency on WhatsApp Service URL through `INTEXURAOS_WHATSAPP_SERVICE_URL`.
- Add WhatsApp Service config for the Matrix outbound adapter base URL and auth secret.
- Wire new env vars through:
  - `apps/calendar-agent/src/index.ts`
  - `apps/whatsapp-service/src/index.ts`
  - `terraform/environments/dev/main.tf`
  - `ecosystem.config.cjs`
- Add the Hetzner Cloud Scheduler job in `terraform/hetzner-prod/scheduler.tf` that calls `POST /internal/calendar/schedules/tick` every 15 minutes with OIDC auth and no request body.
- Add `/internal/calendar/schedules/tick` to `terraform/hetzner-prod/main.tf` `internal_route_owners` with owner `calendar-agent`, so the public Hetzner route can forward to the service.
- Keep `terraform/environments/dev/main.tf` updates scoped to env vars and retained GCP resources that are still owned by that root.
- Verify the deployed route path before wiring Terraform. If the current public nginx/API route exposes Calendar Agent under `/api/calendar`, use that route and set the scheduler audience to the existing IntexuraOS domain convention.
- Do not put Matrix adapter credentials in frontend-accessible configuration.

## Tasks

- [ ] Add Matrix adapter outbound send tests and implementation.
  - [ ] Test missing auth returns unauthorized.
  - [ ] Test missing source account or target room mapping returns a setup-required response.
  - [ ] Test readiness returns `ready` only when the source account and requested target resolve through the same mapping code used by send.
  - [ ] Test readiness returns setup-required without sending any Matrix event when the mapping file, source account, or `intex_agent` target is missing.
  - [ ] Test successful send calls Matrix `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` with the expected text payload.
  - [ ] Implement `GET /internal/matrix/outbound/readiness/:sourceAccountId/:target`.
  - [ ] Implement `POST /internal/matrix/outbound/messages` with request fields `sourceAccountId`, `target`, `text`, and optional idempotency key.
  - [ ] Return `{ status: 'sent', matrixEventId }` on success and `{ status: 'setup_required', reason }` for missing configuration.

- [ ] Add WhatsApp Service private Matrix outbound gateway.
  - [ ] Add route tests for delivery status, missing private account, missing Matrix adapter configuration, and successful outbound send.
  - [ ] Add route tests proving delivery status calls the Matrix adapter readiness endpoint and returns not-ready when `intex_agent` target mapping is absent.
  - [ ] Resolve the active private account through the existing private WhatsApp repository instead of reading another service's data directly.
  - [ ] Implement internal status and outbound message routes.
  - [ ] Register the route in `apps/whatsapp-service/src/routes/index.ts` and document the new paths in `apps/whatsapp-service/src/routes/routes.ts`.
  - [ ] Add Matrix adapter client configuration and service wiring.

- [ ] Add a typed WhatsApp Service internal client.
  - [ ] Create request and response types for delivery status and outbound Matrix messages.
  - [ ] Implement the client using `createInternalHttpClient`.
  - [ ] Export it from `packages/internal-clients`.
  - [ ] Add client tests for URL paths, auth header behavior, and response handling.

- [ ] Add Calendar Agent schedule domain and repository.
  - [ ] Add schedule time tests for HH:mm validation, 15-minute increments, timezone validation, and next-run calculation.
  - [ ] Add Firestore repository tests for upsert, lookup by user/task type, due schedule claiming, lease expiry, run recording, success, and failure.
  - [ ] Add the schedule and schedule-run models, ports, use cases, and Firestore repository.
  - [ ] Register `calendar_schedules` and `calendar_schedule_runs` in Firestore metadata and migration indexes.

- [ ] Add Calendar Agent public schedule routes.
  - [ ] Add tests for authenticated GET and PUT.
  - [ ] Validate that enabled schedules require a valid `HH:mm` local time and IANA timezone.
  - [ ] Return delivery readiness from WhatsApp Service so the web card can show Matrix setup status.
  - [ ] Register schedule routes and internal tick routes in `apps/calendar-agent/src/server.ts` and update OpenAPI tags if needed.
  - [ ] Keep schedule writes scoped to the authenticated user.

- [ ] Add Calendar Agent internal scheduler tick.
  - [ ] Add tests that the route accepts Cloud Scheduler OIDC and internal auth, rejects unauthenticated calls, and accepts an empty body.
  - [ ] Claim due schedules in bounded batches so multiple tick workers do not send duplicates.
  - [ ] Send the literal scheduled prompt through the WhatsApp Service Matrix outbound client.
  - [ ] Record one schedule run per schedule/local date and prevent duplicate sends for the same local date.
  - [ ] On success, update `lastRunAt`, `lastRunLocalDate`, and `nextRunAt`.
  - [ ] On failure or setup-required response, record the error and compute the next retry or next daily run using explicit tests.

- [ ] Add Calendar settings UI.
  - [ ] Add tests for rendering disabled/enabled states, 15-minute time options, saving updates, API errors, and Matrix setup messages.
  - [ ] Add `CalendarDailyNotificationCard` to `GoogleCalendarConnectionPage`.
  - [ ] Use the existing settings card/button/form patterns and accessible form controls.
  - [ ] Do not show Matrix tokens or machine secrets in the UI.

- [ ] Add infrastructure and docs.
  - [ ] Wire all new env vars in service entrypoints, Terraform, and local ecosystem config.
  - [ ] Add the 15-minute Hetzner Cloud Scheduler job with a bodyless request in `terraform/hetzner-prod/scheduler.tf`.
  - [ ] Add the Calendar Agent internal route owner mapping in `terraform/hetzner-prod/main.tf`.
  - [ ] Update `docs/setup/16-private-whatsapp-matrix-sync.md` and the Matrix adapter README with outbound setup steps, required secrets, room target mapping, and troubleshooting.
  - [ ] Document that scheduled notifications cannot deliver until the Matrix host exposes the outbound adapter and target mapping.

## Verification

Run these checks before opening the implementation PR:

```bash
pnpm --filter whatsapp-private-matrix-sync test
pnpm --filter whatsapp-service test
pnpm --filter calendar-agent test
pnpm --filter web test
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- calendar-agent
pnpm run verify:workspace:tracked -- web
pnpm run ci:tracked
```

Also verify manually in a development environment:

- Enabling the schedule from `/settings/calendar` creates or updates one `calendar_daily_lookahead` schedule for the current user.
- A scheduler tick sends the Matrix message as the user, not as the business account.
- The message starts a new Intex Agent assistant session.
- The assistant returns calendar events for the next 24 hours through the normal WhatsApp path.
- If Matrix outbound setup is missing, the Calendar settings page clearly explains the required Matrix host changes.
