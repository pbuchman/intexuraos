# CONTINUITY LEDGER - 019 Commands Router Service

## Goal

Create commands-router service: PubSub → Firestore (idempotent) → Gemini classify → Actions

**Success criteria:** Service deployed, WhatsApp publishes commands, Web UI shows inbox

## Constraints / Assumptions

- Firestore only (no Notion)
- Direct Gemini Flash SDK
- Single user MVP
- Idempotency: `sourceType:externalId`

## Key Decisions

| Decision   | Choice                                                       | Rationale                 |
| ---------- | ------------------------------------------------------------ | ------------------------- |
| Storage    | Firestore                                                    | Simpler, no external deps |
| LLM        | Gemini Flash direct                                          | Fast, cheap, dedicated    |
| Categories | todo, research, note, link, calendar, reminder, unclassified | Start simple              |
| Routes     | /internal/router/commands, /router/\*                        | Namespaced                |

## Reasoning Narrative

- Started with /create-service skill integration into continuity workflow
- User specified dedicated Gemini implementation, not reusing infra-gemini
- Confidence must be on Action model (not just classification)

## State

### Done

- 0-0-scaffold-service.md - Service scaffold created with server.ts pattern
- 1-0-domain-models.md - Command/Action models implemented with factories
- 1-1-firestore-repositories.md - Firestore CRUD with idempotency
- 1-2-gemini-classifier.md - Dedicated Gemini Flash classifier (@google/genai SDK)
- 1-3-routes.md - Internal + router routes with ProcessCommandUseCase

### Now

- 2-1-whatsapp-integration.md - Add PubSub publishing to WhatsApp service

### Done (continued)

- 2-0-terraform.md - Cloud Run, PubSub, secrets, CloudBuild

### Next

- 2-2-web-ui.md
- 2-3-verification.md

## Open Questions

- (none)

## Working Set

**Files:**

- apps/commands-router/\* (to create)
- terraform/environments/dev/main.tf
- apps/whatsapp-service/src/routes/webhookRoutes.ts
- apps/web/src/App.tsx

**Commands:**

```bash
npm run ci
cd terraform && terraform fmt -recursive && terraform validate
```
