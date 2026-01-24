# Linear Agent Service - Implementation Instructions

This document provides step-by-step instructions for implementing the `linear-agent` service. Follow tasks in numerical order. Each task file contains detailed requirements and verification steps.

## Overview

The linear-agent service enables voice/text commands via WhatsApp to create Linear issues. The flow is:

```
WhatsApp → commands-agent (classification) → actions-agent (routing) → linear-agent (API) → Linear
```

## Architecture Summary

- **Service name:** `linear-agent`
- **Firestore collections:** `linear_connections`, `linear_failed_issues`
- **Action type:** `linear` (new type added to classification)
- **Authentication:** User-level Linear Personal API key stored in Firestore
- **LLM extraction:** Similar to calendar-agent - extract title, priority, functional/technical details

## Task Execution Rules

1. Execute tasks **sequentially** by tier (0-X-\*.md, then 1-X-\*.md, etc.)
2. Within a tier, execute in sequence order (X-0-\*.md before X-1-\*.md)
3. **NEVER** modify vitest.config.ts coverage thresholds or exclusions
4. **ALWAYS** run verification commands in each task before proceeding
5. After completing each task, **mark it as complete** in CONTINUITY.md
6. **Commit changes** after each task with descriptive message
7. **Continue automatically** to next task unless it's the final task

## Task Structure

| Tier | Task             | Description                                          |
| ---- | ---------------- | ---------------------------------------------------- |
| 0    | 0-0-setup        | Create service scaffolding, package.json, Dockerfile |
| 0    | 0-1-terraform    | Add Terraform module, IAM, secrets                   |
| 0    | 0-2-cloudbuild   | Add Cloud Build configuration                        |
| 1    | 1-0-domain       | Define domain models, ports, errors                  |
| 1    | 1-1-connection   | Implement Linear connection repository (Firestore)   |
| 1    | 1-2-linear-api   | Implement Linear API client                          |
| 1    | 1-3-extraction   | Create LLM extraction service for issues             |
| 1    | 1-4-create-issue | Implement create issue use case                      |
| 1    | 1-5-list-issues  | Implement list issues use case                       |
| 2    | 2-0-routes       | Implement HTTP routes (public + internal)            |
| 2    | 2-1-server       | Create server.ts, config.ts, index.ts                |
| 3    | 3-0-actions      | Update actions-agent with linear handler             |
| 3    | 3-1-commands     | Update commands-agent classification for linear      |
| 4    | 4-0-web-api      | Add linearApi.ts in web app                          |
| 4    | 4-1-web-page     | Create LinearConnectionPage component                |
| 4    | 4-2-web-issues   | Create LinearIssuesPage (dashboard)                  |
| 4    | 4-3-web-routing  | Add routes and navigation for Linear pages           |
| 5    | 5-0-deploy       | Apply Terraform, push images, verify deployment      |
| 5    | 5-1-integration  | End-to-end testing and verification                  |

## Key References

When implementing, use these existing patterns as references:

| Component              | Reference                                                                 |
| ---------------------- | ------------------------------------------------------------------------- |
| Service scaffolding    | `.claude/commands/create-service.md`                                      |
| Connection repository  | `apps/notion-service/src/infra/firestore/notionConnectionRepository.ts`   |
| LLM extraction service | `apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts` |
| Process action usecase | `apps/calendar-agent/src/domain/useCases/processCalendarAction.ts`        |
| Internal routes        | `apps/calendar-agent/src/routes/internalRoutes.ts`                        |
| Action handler         | `apps/actions-agent/src/domain/usecases/handleCalendarAction.ts`          |
| Handler registry       | `apps/actions-agent/src/domain/usecases/actionHandlerRegistry.ts`         |
| Web connection page    | `apps/web/src/pages/GoogleCalendarConnectionPage.tsx`                     |
| Web dashboard          | `apps/web/src/pages/CalendarPage.tsx`                                     |

## Definition of Done

The implementation is complete when:

1. Service runs healthy on GCP Cloud Run
2. Linear API key can be configured via web UI
3. Voice command "create linear issue" creates issue in Linear
4. Dashboard shows issues in 3 columns (grouped by status)
5. All tests pass with 95% coverage
6. `pnpm run ci:tracked` passes
7. `tf validate` passes in terraform directory

## Resume Procedure

If interrupted:

1. Read `CONTINUITY.md` to understand current state
2. Find the last completed task (marked with ✅)
3. Continue with the next pending task
4. Update CONTINUITY.md as you progress

## Important Notes

- Use `tf` command (not `terraform`) due to emulator env vars
- Never push to remote without explicit instruction
- Linear Personal API keys can be created at: https://linear.app/settings/api
- The Linear SDK package is `@linear/sdk`
