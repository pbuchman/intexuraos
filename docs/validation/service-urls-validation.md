# Service URL Configuration Cross-Validation Report

**Generated:** 2026-02-19
**Scope:** Service URL mapping across ecosystem.config.cjs, terraform/environments/dev/main.tf, and packages/internal-clients

---

## Summary

| Metric                                  | Count |
| --------------------------------------- | ----- |
| Services with URL env vars              | 19    |
| Consistent across ecosystem + terraform | 18    |
| In terraform only (not in ecosystem)    | 1     |
| In ecosystem only (not in terraform)    | 0     |
| In internal-clients (as typed client)   | 1     |
| Discrepancies                           | 2     |

---

## URL Mapping Matrix

All service URLs follow the pattern `INTEXURAOS_<SERVICE>_URL`.

| Service                      | Ecosystem (`COMMON_SERVICE_URLS`)                     | Terraform (`common_service_env_vars`)         | Internal-Clients Usage                            | Status      |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | ----------- |
| user-service                 | `INTEXURAOS_USER_SERVICE_URL` (:8110)                 | `INTEXURAOS_USER_SERVICE_URL`                 | `createUserServiceClient` uses `config.baseUrl`   | OK          |
| notion-service               | `INTEXURAOS_NOTION_SERVICE_URL` (:8112)               | `INTEXURAOS_NOTION_SERVICE_URL`               | Direct fetch in research-agent                    | OK          |
| whatsapp-service             | `INTEXURAOS_WHATSAPP_SERVICE_URL` (:8113)             | `INTEXURAOS_WHATSAPP_SERVICE_URL`             | Direct fetch in code-agent                        | OK          |
| mobile-notifications-service | `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL` (:8114) | `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL` | Direct fetch in internal consumers                | OK          |
| research-agent               | `INTEXURAOS_RESEARCH_AGENT_URL` (:8116)               | `INTEXURAOS_RESEARCH_AGENT_URL`               | Direct fetch in actions-agent                     | OK          |
| commands-agent               | `INTEXURAOS_COMMANDS_AGENT_URL` (:8117)               | `INTEXURAOS_COMMANDS_AGENT_URL`               | Direct fetch in commands-agent/web                | OK          |
| actions-agent                | `INTEXURAOS_ACTIONS_AGENT_URL` (:8118)                | `INTEXURAOS_ACTIONS_AGENT_URL`                | Direct fetch in code-agent, commands-agent        | OK          |
| image-service                | `INTEXURAOS_IMAGE_SERVICE_URL` (:8120)                | `INTEXURAOS_IMAGE_SERVICE_URL`                | Direct fetch in research-agent                    | OK          |
| notes-agent                  | `INTEXURAOS_NOTES_AGENT_URL` (:8121)                  | `INTEXURAOS_NOTES_AGENT_URL`                  | Direct fetch in actions-agent                     | OK          |
| app-settings-service         | `INTEXURAOS_APP_SETTINGS_SERVICE_URL` (:8122)         | `INTEXURAOS_APP_SETTINGS_SERVICE_URL`         | Direct fetch in multiple services                 | OK          |
| retired-checklist-service                  | `INTEXURAOS_RETIRED_CHECKLIST_SERVICE_URL` (:8123)                  | `INTEXURAOS_RETIRED_CHECKLIST_SERVICE_URL`                  | Direct fetch in actions-agent                     | OK          |
| bookmarks-agent              | `INTEXURAOS_BOOKMARKS_AGENT_URL` (:8124)              | `INTEXURAOS_BOOKMARKS_AGENT_URL`              | Direct fetch in actions-agent                     | OK          |
| calendar-agent               | `INTEXURAOS_CALENDAR_AGENT_URL` (:8125)               | `INTEXURAOS_CALENDAR_AGENT_URL`               | Direct fetch in actions-agent                     | OK          |
| linear-agent                 | `INTEXURAOS_LINEAR_AGENT_URL` (:8126)                 | `INTEXURAOS_LINEAR_AGENT_URL`                 | Direct fetch in actions-agent, code-agent         | OK          |
| web-agent                    | `INTEXURAOS_WEB_AGENT_URL` (:8127)                    | `INTEXURAOS_WEB_AGENT_URL`                    | Direct fetch in whatsapp-service, bookmarks-agent | OK          |
| code-agent                   | `INTEXURAOS_CODE_AGENT_URL` (:8128)                   | `INTEXURAOS_CODE_AGENT_URL`                   | Direct fetch in actions-agent                     | OK          |
| retired-chat-service                   | `INTEXURAOS_RETIRED_CHAT_SERVICE_URL` (:8129)                   | `INTEXURAOS_RETIRED_CHAT_SERVICE_URL`                   | Direct fetch in web                               | OK          |
| api-docs-hub                 | **MISSING**                                           | `INTEXURAOS_API_DOCS_HUB_URL`                 | No code references found                          | DISCREPANCY |

---

## Special Cases

### code-agent Self-Reference URL (`INTEXURAOS_SERVICE_URL`)

`code-agent` uses two distinct URL variables:

| Variable                    | Purpose                                               | Ecosystem                               | Terraform                               |
| --------------------------- | ----------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `INTEXURAOS_CODE_AGENT_URL` | Used by OTHER services to call code-agent             | In `COMMON_SERVICE_URLS`                | In `common_service_env_vars`            |
| `INTEXURAOS_SERVICE_URL`    | Used BY code-agent itself (for webhook callback URLs) | In `SERVICE_ENV_MAPPINGS['code-agent']` | In code-agent-specific `env_vars` block |

Both are consistent and intentional. `INTEXURAOS_SERVICE_URL` is deliberately not prefixed with the service name as it is a self-reference pattern.

### Internal-Clients Package Scope

The `packages/internal-clients` package contains only one typed client: `createUserServiceClient`. All other inter-service HTTP calls are implemented as direct `fetch()` calls within each app, not through shared client packages. The user-service client uses an injected `baseUrl` parameter (not a direct `process.env` read), which means env var consistency is enforced at the app's `services.ts` injection site.

---

## Discrepancies

### DISCREPANCY-1: `INTEXURAOS_API_DOCS_HUB_URL` missing from ecosystem.config.cjs

**Severity:** MEDIUM

| Attribute                              | Value                              |
| -------------------------------------- | ---------------------------------- |
| Variable                               | `INTEXURAOS_API_DOCS_HUB_URL`      |
| In terraform `common_service_env_vars` | YES (line 285)                     |
| In ecosystem `COMMON_SERVICE_URLS`     | NO                                 |
| Code references in apps/               | None found                         |
| `api-docs-hub` in PM2 ecosystem        | NO (no `createServiceConfig` call) |

**Analysis:** The `api-docs-hub` service exists as an app (`apps/api-docs-hub/`) and is deployed to Cloud Run (terraform module at line 961), but it is not managed by PM2 in the local/dev environment (`ecosystem.config.cjs`). Because `INTEXURAOS_API_DOCS_HUB_URL` is in terraform's `common_service_env_vars`, it is distributed to all services in production — but no app currently reads this variable. This is an orphaned URL in terraform.

**If** a future service needs to call api-docs-hub, the variable is already distributed via terraform but would need to be added to `COMMON_SERVICE_URLS` in ecosystem.config.cjs for local/dev parity.

**Root cause risk:** api-docs-hub itself is also absent from ecosystem.config.cjs — if it requires service-to-service calls from local services, those would fail in the dev environment.

**Action:** Confirm whether api-docs-hub is intentionally excluded from PM2 (e.g., only used in production). If it should run locally, add it to ecosystem.config.cjs and add `INTEXURAOS_API_DOCS_HUB_URL` to `COMMON_SERVICE_URLS`.

---

### DISCREPANCY-2: Internal-clients package has no clients for most services

**Severity:** LOW (architectural observation, not a functional bug)

| Attribute                          | Value                                          |
| ---------------------------------- | ---------------------------------------------- |
| Services with shared typed clients | 1 (user-service only)                          |
| Services relying on direct fetch   | 18                                             |
| Consistency of env var names       | All consistent between ecosystem and terraform |

**Analysis:** The `packages/internal-clients` package is not a comprehensive inter-service client library — it only covers user-service. All other inter-service calls use raw `fetch()` with `X-Internal-Auth` headers directly in app code. This is a structural pattern, not a bug, but it means there is no single place to verify URL env var usage for non-user services. The env var names are consistent between ecosystem.config.cjs and terraform for all 18 services.

**Action:** No immediate action required. If the internal-clients package is intended to grow, document this pattern gap.

---

## Action Items

| Priority | Item                                                                                                                     | Severity |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1        | Confirm whether api-docs-hub should run locally via PM2; if yes, add to ecosystem.config.cjs                             | MEDIUM   |
| 2        | Determine if `INTEXURAOS_API_DOCS_HUB_URL` in terraform is forward-looking or orphaned; remove if no consumer is planned | MEDIUM   |
| 3        | Document that inter-service URL access pattern uses direct fetch (not internal-clients) for all non-user services        | LOW      |

---

## Verification Commands

```bash
# Find all SERVICE_URL references in apps
grep -r "INTEXURAOS_.*SERVICE_URL\|INTEXURAOS_.*AGENT_URL" apps/ --include="*.ts" -l

# Check ecosystem vs terraform URL key alignment
node -e "
const eco = require('./ecosystem.config.cjs');
// COMMON_SERVICE_URLS is defined in the file but not exported — inspect source
"

# Verify api-docs-hub is NOT in PM2
pm2 list | grep api-docs
```
