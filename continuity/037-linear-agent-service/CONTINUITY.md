# Linear Agent Service - Continuity Ledger

## Goal

Implement a fully functional `linear-agent` service that enables creating Linear issues via voice/text commands through WhatsApp, with a web dashboard for viewing issues.

### Success Criteria

- [ ] Service deployed and healthy on GCP Cloud Run
- [ ] User can configure Linear API key via web UI
- [ ] Voice command classification works for "linear" type
- [ ] Issues created successfully via WhatsApp commands
- [ ] Dashboard shows issues grouped by status (3 columns + archive)
- [ ] 95% test coverage maintained
- [ ] All CI checks pass

## Constraints / Assumptions

1. Linear authentication uses Personal API keys (not OAuth)
2. User-level API key storage (each user has their own key)
3. Team ID is user-configurable (selected during connection setup)
4. LLM extraction extracts: title, priority, functional/technical details
5. Issue creation is synchronous (action completes/fails immediately)
6. Dashboard polling interval fixed at 1 minute
7. New `linear` action type added to classification (not reusing `todo`)

## Key Decisions

| Decision           | Choice                      | Rationale                                          |
| ------------------ | --------------------------- | -------------------------------------------------- |
| Service naming     | `linear-agent`              | Follows -agent pattern for action handlers         |
| Auth model         | User-level API key          | Matches notion_connections pattern                 |
| Team configuration | User-selectable on connect  | Flexibility for different workspaces               |
| Action type        | New `linear` type           | Clean separation, proper classification            |
| LLM extraction     | Title + priority + details  | Rich structured issue creation                     |
| Description format | Structured markdown         | ## Title, ## Functional, ## Technical sections     |
| Dashboard columns  | 3 + archive                 | Backlog+Todo, In Progress, In Review, Done archive |
| Done filter        | Last week + collapsed older | Balance between visibility and clutter             |

## State

### Done

- ✅ **0-0-setup**: Service scaffolding created (package.json, Dockerfile, tsconfig.json, directory structure)
- ✅ **0-1-terraform**: Terraform configuration added (service module, IAM service account, Firestore collections)
- ✅ **0-2-cloudbuild**: Cloud Build configuration added (build/deploy steps, scripts, all config files)
- ✅ **1-0-domain**: Domain models, ports, and errors defined (models.ts, errors.ts, ports.ts, index.ts)

### Now

**Task 1-1-connection**: Implement Linear connection repository

### Next

- 1-2-linear-api: Implement Linear API client
- Continue through all tiers...

## Open Questions

_None - all questions resolved with user_

## Working Set

### Files to Create (linear-agent)

```
apps/linear-agent/
├── Dockerfile
├── package.json
├── cloudbuild.yaml
├── tsconfig.json
└── src/
    ├── index.ts
    ├── server.ts
    ├── config.ts
    ├── services.ts
    ├── domain/
    │   ├── models.ts
    │   ├── errors.ts
    │   ├── ports.ts
    │   └── useCases/
    │       ├── processLinearAction.ts
    │       └── listIssues.ts
    ├── infra/
    │   ├── firestore/
    │   │   ├── linearConnectionRepository.ts
    │   │   └── failedIssueRepository.ts
    │   ├── linear/
    │   │   └── linearApiClient.ts
    │   └── llm/
    │       └── linearActionExtractionService.ts
    └── routes/
        ├── linearRoutes.ts
        └── internalRoutes.ts
```

### Files to Modify

- `terraform/environments/dev/main.tf` - Add service module
- `terraform/modules/cloud-build/main.tf` - Add to docker_services
- `.github/scripts/smart-dispatch.mjs` - Add to SERVICES
- `scripts/detect-tf-changes.sh` - Add to ALL_SERVICES
- `scripts/dev.mjs` - Add local dev config
- `.envrc.local.example` - Add env vars
- `firestore-collections.json` - Register collections
- `tsconfig.json` - Add reference
- `apps/actions-agent/src/domain/usecases/actionHandlerRegistry.ts` - Add linear handler
- `apps/actions-agent/src/domain/models/action.ts` - Add 'linear' type
- `apps/commands-agent/src/domain/models/action.ts` - Add 'linear' type
- `packages/llm-common/src/classification/commandClassifierPrompt.ts` - Add linear classification
- `apps/web/src/services/` - Add linearApi.ts
- `apps/web/src/pages/` - Add Linear pages
- `apps/web/src/App.tsx` - Add routes

### Environment Variables

| Variable                       | Source         | Description             |
| ------------------------------ | -------------- | ----------------------- |
| INTEXURAOS_LINEAR_AGENT_URL    | Terraform      | Service URL for routing |
| INTEXURAOS_USER_SERVICE_URL    | common_service | User settings access    |
| INTEXURAOS_INTERNAL_AUTH_TOKEN | Secret Manager | Service-to-service auth |
| INTEXURAOS_GCP_PROJECT_ID      | common_service | Firestore project       |

### Linear API Reference

- SDK: `@linear/sdk`
- Auth: Personal API key via `LinearClient({ apiKey })`
- Create issue: `linearClient.createIssue({ title, description, teamId, priority })`
- List issues: `linearClient.issues({ filter: { team: { id: { eq: teamId } } } })`
- Priority values: 0 (none), 1 (urgent), 2 (high), 3 (normal), 4 (low)

### Classification Trigger Phrases

- "create linear issue"
- "nowe zadanie w linear"
- "dodaj do lineara"
- "add to linear"
- "new linear task"
- "linear issue"

---

_Last updated: Session start_
