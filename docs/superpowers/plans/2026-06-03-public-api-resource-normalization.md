# Public API Resource Name Normalization

Goal sentence: Normalize IntexuraOS public API resource names so service mounts are not duplicated in backend routes, frontend calls, OpenAPI, active docs, and deployment guidance, then open a pull request from a feature branch into `development`.

## Execution Contract For The New Agent

- Start from a fresh feature branch based on latest `development`.
- Do not ask for or require a Linear issue ID; the Linear issue will be created automatically by the normal workflow.
- The required final result is a GitHub pull request targeting `development` from the feature branch, containing all code, tests, docs, and verification changes for this migration step.
- During execution, request a self-review from a specialized subagent after the implementation and local verification are complete, but before opening or finalizing the pull request.
- Use a hard cutover: do not add legacy route aliases and do not use nginx, Vite, or edge rewrites as the main fix.
- Keep public service mounts unchanged in `apps/web/service-manifest.json`, Vite proxy generation, nginx `/api/<service>` routing, PM2 public URL generation, and Terraform service URL maps.
- No Terraform migration is expected because the public service mounts remain unchanged; only inspect Terraform if implementation evidence contradicts this assumption.
- Update active documentation only; do not rewrite historical `docs/plans/**` or archived documents unless they are active operational guidance.

## Current Problem

Public routes are composed from two layers:

- Public mount: `/api/<service-resource>` from `apps/web/service-manifest.json`, nginx, Vite proxying, and PM2 generated public URLs.
- Service-local Fastify route: many services also start their local public routes with the same resource name.

This creates duplicated public URLs such as:

- `/api/linear/linear/webhook`
- `/api/whatsapp/whatsapp/webhooks`
- `/api/code/code/tasks`
- `/api/research/research`
- `/api/actions/actions/:id`

The desired design is:

- The public mount owns the service resource namespace.
- The service-local public API exposes resources relative to that mount.
- Frontend clients pass paths relative to their configured service base URL.
- OpenAPI exposes canonical local routes only.

## Required Route Changes

Keep all public mounts unchanged. Normalize service-local public routes as follows.

| Service | Public Mount | Current Local Prefix | New Local/Public Shape |
|---|---|---|---|
| `whatsapp-service` | `/api/whatsapp` | `/whatsapp/*` | `/connect`, `/status`, `/disconnect`, `/preferences`, `/messages/*`, `/verify/*`, `/webhooks` |
| `linear-agent` | `/api/linear` | `/linear/*` | `/connection`, `/issues/*`, `/webhook`, `/webhook-config`, `/sync`, `/failed-issues/*`, `/prune-candidates` |
| `code-agent` | `/api/code` | `/code/*` | `/tasks`, `/submit`, `/retry`, `/cancel`, `/queue`, `/worker-settings/*`, `/merge-queue/*`; keep `/webhooks/github` unchanged |
| `research-agent` | `/api/research` | `/research/*` | `/`, `/:id`, `/draft`, `/validate-input`, `/improve-input`, `/settings/notion/*`, `/openrouter/models` |
| `actions-agent` | `/api/actions` | `/actions/*` | `/`, `/:actionId`, `/:actionId/execute`, `/:actionId/resolve-duplicate`, `/batch` |
| `commands-agent` | `/api/commands` | `/commands/*` | `/`, `/:commandId` |
| `notes-agent` | `/api/notes` | `/notes/*` | `/`, `/:noteId` |
| `todos-agent` | `/api/todos` | `/todos/*` | `/`, `/:todoId`, item/reorder subroutes without `/todos` prefix |
| `bookmarks-agent` | `/api/bookmarks` | `/bookmarks/*` | `/`, `/:bookmarkId`, refresh/summarize subroutes; keep `/images/proxy` if still routed by this service |
| `calendar-agent` | `/api/calendar` | `/calendar/*` | `/events`, `/events/:id`, `/freebusy`, `/failed-events/*` |
| `chat-agent` | `/api/chat` | `/chat` | `/`; keep `/guest-session` |
| `mobile-notifications-service` | `/api/notifications` | `/mobile-notifications/*`, `/notifications/*` | `/`, `/:notificationId`, `/connect`, `/status`, `/webhooks`, `/filters/*`, `/digests/*` |
| `notion-service` | `/api/notion` | `/notion/*`, `/notion-webhooks` | `/connect`, `/status`, `/disconnect`, `/webhooks` |
| `fishing-assistant-service` | `/api/fishing-assistant` | `/fishing/*`, `/fishing-assistant/status` | `/status`, `/chats/*`, `/digests/*`, `/digest-groups`, `/folders/*`, `/pages/*` |
| `cron-agent` | `/api/cron-agent` | `/cron/*` | `/services`, `/schedules/*`, `/executions/*` |
| `hellscript-agent` | `/api/hellscript-agent` | `/hellscript/*` | `/buffers`, `/impose`, `/writing-config/*` |
| `llm-usage-service` | `/api/llm-usage` | `/llm-usage/*` | `/query`, `/pricing`, `/events/list`, `/events/:eventId` |

Leave unchanged:

- `user-service` public routes: `/auth`, `/oauth`, `/users`.
- `image-service`, `web-agent`, and `app-settings-service` unless investigation finds a public duplicated route.
- All `/internal/*` routes.
- `/health`, `/openapi.json`, and `/docs`.
- Code agent GitHub webhook path `/api/code/webhooks/github`.

## Implementation Steps

1. Run the session start gate: read `AGENTS.md`, `.claude/CLAUDE.md`, and every concrete file required by `.claude/CLAUDE.md`.
2. Update `development` and create a feature branch:

   ```bash
   git checkout development
   git pull --ff-only origin development
   git checkout -b int-public-api-resource-normalization
   ```

3. Re-run a read-only route audit before editing:

   ```bash
   rg -n "(/linear|/whatsapp|/code|/research|/actions|/commands|/notes|/todos|/bookmarks|/calendar|/cron|/hellscript|/llm-usage|/mobile-notifications|/notifications|/notion|/fishing)" apps packages docs .claude scripts --glob '!**/node_modules/**'
   ```

4. Add a static verifier, for example `scripts/verify-route-resource-names.mjs`, that:
   - Reads `apps/web/service-manifest.json`.
   - Extracts Fastify route literals from `apps/*/src`.
   - Ignores `/internal/*`, `/health`, `/openapi.json`, and `/docs`.
   - Fails if a public service-local route starts with that service mount's resource segment.
   - Includes known alias checks such as `mobile-notifications-service` using `/mobile-notifications/*`, `fishing-assistant-service` using `/fishing/*`, `cron-agent` using `/cron/*`, and `hellscript-agent` using `/hellscript/*`.
5. Extend the verifier to scan frontend usage in `apps/web/src` and `apps/web/src/config/action-config.yaml`, failing calls like `apiRequest(config.linearAgentUrl, '/linear/...')`.
6. Wire the verifier into the repository's verification path in the same style as existing scripts.
7. Refactor backend Fastify public route literals to the canonical local paths in the route table.
8. Update frontend API clients, hooks, utilities, and `action-config.yaml` so all path arguments are relative to their configured service base URL.
9. Update OpenAPI contract tests so canonical paths are visible and old duplicated paths are absent.
10. Update route and unit tests for every touched service to call canonical local routes.
11. Update active docs only:
    - `README.md` if it contains current API guidance.
    - `.claude` service-creation guidance if it teaches duplicated route construction.
    - `docs/services/**`.
    - `docs/runbooks/**`.
    - `docs/operations/**`.
    - `docs/architecture/**`.
12. Update external webhook guidance to these production URLs:
    - WhatsApp: `https://intexuraos.cloud/api/whatsapp/webhooks`
    - Linear: `https://intexuraos.cloud/api/linear/webhook`
    - Notion, if used: `https://intexuraos.cloud/api/notion/webhooks`
    - GitHub code webhook unchanged: `https://intexuraos.cloud/api/code/webhooks/github`
13. Run targeted verification for each touched service and web.
14. Run the broad tracked verification command used by the repo, expected to include:

    ```bash
    pnpm run verify:service-wiring
    pnpm run ci:tracked
    ```

15. Request self-review from a specialized subagent:
    - Ask the subagent to perform an independent read-only review of route normalization, frontend URL composition, OpenAPI visibility, docs, and tests.
    - Ask it to identify missed duplicated URLs and rollout risks.
    - Integrate any valid findings before PR creation.
16. Open a GitHub pull request from the feature branch into `development`.
17. The PR description must include:
    - The route graph summary.
    - A hard-cutover warning.
    - The external webhook update list.
    - Evidence that no Terraform migration was required, or explicit Terraform changes if implementation disproves that assumption.
    - Verification commands and results.
    - The subagent self-review summary.

## Test Plan

Run targeted tests for every touched service plus web. The exact workspace filter names must be verified from package manifests, but the expected coverage is:

```bash
pnpm --filter web test
pnpm --filter whatsapp-service test
pnpm --filter linear-agent test
pnpm --filter code-agent test
pnpm --filter research-agent test
pnpm --filter actions-agent test
pnpm --filter commands-agent test
pnpm --filter mobile-notifications-service test
pnpm --filter cron-agent test
pnpm run verify:service-wiring
pnpm run ci:tracked
```

Acceptance checks:

- Static verifier fails on `/api/linear/linear`, `/api/whatsapp/whatsapp`, `/api/code/code`, and equivalent duplicated frontend calls.
- OpenAPI exposes canonical paths only.
- Frontend requests compose clean URLs from existing service base URLs.
- `/api/<service>/internal/*` remains blocked by nginx.
- Production smoke guidance covers at least WhatsApp, Linear, Code, Research, Actions, Notifications, Cron, and LLM usage canonical URLs.

## Production Deployment Notes

This is a hard cutover. External systems calling old duplicated webhook URLs must be updated during the deployment window.

Required external webhook targets after deployment:

```text
WhatsApp: https://intexuraos.cloud/api/whatsapp/webhooks
Linear:   https://intexuraos.cloud/api/linear/webhook
Notion:   https://intexuraos.cloud/api/notion/webhooks
GitHub:   https://intexuraos.cloud/api/code/webhooks/github
```

No old duplicated URL should be documented as valid after this PR.

## Assumptions

- Hard cutover was explicitly chosen by the user.
- The agent must not create legacy aliases.
- The agent must not wait for a manually provided Linear issue ID.
- Public service mounts remain unchanged, so Terraform changes are not expected.
- Historical plans remain historical records and should not be mass rewritten.
