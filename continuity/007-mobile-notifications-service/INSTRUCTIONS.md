# Instructions — 007-mobile-notifications-service

## Task Overview

Create a new `mobile-notifications` service for IntexuraOS that:

1. Accepts mobile device notifications via webhook (from Tasker)
2. Stores notifications in Firestore linked to authenticated users
3. Provides API endpoints for listing and deleting notifications
4. Includes a web UI view for displaying notifications

## Numbering Convention

```
[tier]-[sequence]-[title].md

0-X: Setup/cleanup tasks
1-X: Independent backend deliverables
2-X: Dependent/integration tasks (routes, API hub, terraform, cloudbuild)
3-X: Frontend tasks
4-X: Coverage verification and archival
```

## Execution Rules

1. Execute tasks in order by tier
2. Update CONTINUITY.md after each task
3. Run `npm run ci` after each code change
4. Do not proceed to next tier until current tier is complete

## Key Technical Decisions

| Decision             | Choice                                             |
| -------------------- | -------------------------------------------------- |
| Signature format     | Crypto-secure random token (32 bytes, hex encoded) |
| Signature storage    | SHA-256 hash only (plaintext never stored)         |
| Signature header     | `X-Mobile-Notifications-Signature`                 |
| Auth for /connect    | JWT required                                       |
| Auth for webhook     | Signature only (no JWT)                            |
| Idempotency          | `notification_id` per user                         |
| Pagination           | cursor-based, default limit 50                     |
| Retention            | Indefinite (manual delete only)                    |
| Delete type          | Hard delete                                        |
| Web route            | `#/mobile-notifications`                           |
| Coverage requirement | 90% (lines, branches, functions, statements)       |

## Environment Variable Naming Convention

**All env variables MUST start with `INTEXURAOS_` prefix.**

Service-specific variables:

- `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL` (for API hub)

Standard variables (inherited from other services):

- `INTEXURAOS_AUTH_JWKS_URL`
- `INTEXURAOS_AUTH_ISSUER`
- `INTEXURAOS_AUTH_AUDIENCE`

## Required Files

### .env.example

Each service must have a `.env.example` file documenting all required env vars:

```
# Auth configuration
INTEXURAOS_AUTH_JWKS_URL=
INTEXURAOS_AUTH_ISSUER=
INTEXURAOS_AUTH_AUDIENCE=

# GCP configuration
PROJECT_ID=
```

### Terraform

- Add to `terraform/environments/dev/main.tf`
- Add service account and IAM bindings
- Follow existing patterns from other services

### Cloud Build

- Add `cloudbuild/scripts/deploy-mobile-notifications-service.sh`
- Update `cloudbuild/scripts/detect-affected.mjs` if needed
- Follow existing patterns from other deploy scripts

## Verification

```bash
npm run ci                        # Must pass before task completion
terraform fmt -check -recursive   # If terraform changed (from /terraform)
terraform validate                # If terraform changed
```
