# 019 - Commands Router Service

## Goal

Create a new `commands-router` service that:

1. Receives commands from PubSub (from WhatsApp text/voice messages)
2. Stores commands in Firestore with idempotency
3. Classifies commands using Gemini Flash
4. Creates pending actions based on classification
5. Exposes API for web UI to display commands and actions

## Success Criteria

- [ ] Service scaffold created using `/create-service`
- [ ] Domain models (Command, Action) implemented
- [ ] Firestore repositories with idempotency
- [ ] Gemini classifier (direct SDK, Flash model)
- [ ] Routes: `POST /internal/router/commands`, `GET /router/commands`, `GET /actions`
- [ ] Terraform: Cloud Run + PubSub topic/subscription
- [ ] WhatsApp integration: publish on text save + voice transcription
- [ ] Web UI: Inbox page with Commands/Actions tabs
- [ ] `npm run ci` passes
- [ ] `terraform validate` passes

## Constraints

- Use Firestore for storage (no Notion sync)
- Direct Gemini SDK (not infra-gemini or research-agent)
- Idempotency key: `sourceType:externalId`
- Auth: X-Internal-Auth header for PubSub push

## Task Numbering

```
0-X-*.md  → Tier 0: Setup/scaffolding
1-X-*.md  → Tier 1: Independent deliverables
2-X-*.md  → Tier 2: Dependent/integrative work
```

## Execution Process

1. Execute tasks sequentially by tier
2. Update CONTINUITY.md after each task
3. Mark task as complete only when verified
4. Continue to next task without stopping (except final)

## Verification Commands

```bash
npm run ci
cd terraform && terraform fmt -recursive && terraform validate
```
