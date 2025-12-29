# Continuity Ledger — 007-mobile-notifications-service

## Goal

Create a new `mobile-notifications` service that:

1. Receives mobile device notifications via authenticated webhook
2. Links notifications to users via secure signature tokens
3. Provides REST API for listing/deleting notifications
4. Includes web UI for viewing and managing notifications

**Success Criteria:**

1. Service deployed and functional
2. 90% test coverage (no changes to vitest.config.ts)
3. API documented in API Hub
4. Connection page at `#/mobile-notifications` (generate signature, view status)
5. Notifications list page at `#/mobile-notifications/list` (view, delete)
6. Xiaomi/Tasker setup documentation complete
7. All CI checks pass

---

## Constraints / Assumptions

- Signature: crypto-secure random, stored as SHA-256 hash only
- No automatic retention/TTL - manual delete only
- Idempotency via `notification_id` per user
- Pagination: cursor-based, default limit 50
- Coverage thresholds: 90% across all metrics
- No disconnect option - user regenerates signature to invalidate

---

## Key Decisions

### 2024-12-27: Architecture decisions from requirements

**Signature handling:**

- Generated at `/connect` (JWT required)
- Returned to client once, stored as hash
- Header: `X-Mobile-Notifications-Signature`

**Authentication matrix:**
| Endpoint | Auth |
|----------|------|
| POST /v1/mobile-notifications/connect | JWT |
| POST /v1/webhooks/mobile-notifications | Signature only |
| GET /v1/mobile-notifications | JWT |
| DELETE /v1/mobile-notifications/:id | JWT + ownership |

**Webhook response:**

- Always 200 OK
- `{ "status": "accepted", "id": "<id>" }` or `{ "status": "ignored" }`

**Storage model:**

- userId, source, device, app, title, text, timestamp, receivedAt, notification_id

### 2024-12-27: Web UI requirements clarification

**Connection page (`#/mobile-notifications`):**

- Generate signature button (shown once with copy option)
- Regenerate signature when one exists
- Status block showing last notification received time
- No disable option (user regenerates to invalidate)
- Link to Xiaomi/Tasker setup documentation

**Notifications list page (`#/mobile-notifications/list`):**

- Android-style notification cards
- Delete with confirmation
- Pagination (load more)

---

## Reasoning Narrative

Service follows existing patterns from whatsapp-service and user-service.
Domain structure: `domain/notifications/{models, ports, usecases}`
Infra adapters for Firestore repositories.
Routes kept minimal - business logic in usecases.

---

## State

### Done:

- [x] Requirements clarification
- [x] Created continuity folder
- [x] Created INSTRUCTIONS.md
- [x] Created all issue files (0-0 through 4-1)
- [x] Added 3-1-create-connection-page.md (new requirement)
- [x] Updated 2-3-update-documentation.md with Xiaomi setup guide
- [x] 0-0: Setup service scaffold (backend complete)
- [x] 1-0 through 1-6: Domain layer (models, repositories, usecases)
- [x] 2-0: Routes (connect, webhook, list, delete)
- [x] 2-1: Added to API Hub
- [x] 2-2: Added Terraform
- [x] 2-4: Added CloudBuild deploy script
- [x] Backend tests (29 tests passing)
- [x] 3-1: Create Mobile Notifications Connection Page (web UI)
- [x] 3-0: Create Mobile Notifications List Page (web UI)
- [x] 2-3: Update Documentation (README, Xiaomi setup guide)
- [x] 4-0: Coverage verification (CI passes)

### Now:

- 4-1: Final cleanup and archive

### Next:

- Archive continuity folder

---

## Open Questions

None - all clarified in requirements document.

---

## Working Set

**Issue files created:**

- 0-0-setup-service-scaffold.md (includes .env.example)
- 1-0-create-domain-models.md
- 1-1-create-signature-repository.md
- 1-2-create-notification-repository.md
- 1-3-create-connect-usecase.md
- 1-4-create-webhook-usecase.md
- 1-5-create-list-notifications-usecase.md
- 1-6-create-delete-notification-usecase.md
- 2-0-create-routes.md
- 2-1-add-to-api-hub.md
- 2-2-add-terraform.md
- 2-3-update-documentation.md (updated with Xiaomi guide)
- 2-4-add-cloudbuild.md
- 3-0-create-web-view.md (notifications list)
- 3-1-create-connection-page.md (NEW - connection/setup page)
- 4-0-coverage-verification.md
- 4-1-final-cleanup.md

**Env variable naming convention:**

- All variables must start with `INTEXURAOS_` prefix
- Service URL: `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL`

**Commands:**

```bash
npm run ci                    # Full verification
npm run test:coverage         # Coverage check
terraform fmt -recursive      # Format terraform
terraform validate            # Validate terraform
```
