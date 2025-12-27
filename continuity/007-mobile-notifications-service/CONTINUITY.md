# Continuity Ledger — 007-mobile-notifications-service

## Goal

Create a new `mobile-notifications` service that:

1. Receives mobile device notifications via authenticated webhook
2. Links notifications to users via secure signature tokens
3. Provides REST API for listing/deleting notifications
4. Includes web UI for viewing notifications

**Success Criteria:**

1. Service deployed and functional
2. 90% test coverage (no changes to vitest.config.ts)
3. API documented in API Hub
4. Web view accessible at `#/mobile-notifications`
5. All CI checks pass

---

## Constraints / Assumptions

- Signature: crypto-secure random, stored as SHA-256 hash only
- No automatic retention/TTL - manual delete only
- Idempotency via `notification_id` per user
- Pagination: cursor-based, default limit 50
- Coverage thresholds: 90% across all metrics

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

---

## Reasoning Narrative

Service follows existing patterns from whatsapp-service and auth-service.
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

### Now:

- **AWAITING USER CONFIRMATION** to proceed with implementation

### Next:

- 0-0: Setup service scaffold

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
- 2-3-update-documentation.md
- 2-4-add-cloudbuild.md
- 3-0-create-web-view.md
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
