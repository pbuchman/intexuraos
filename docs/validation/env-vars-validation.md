# Environment Variables Cross-Validation Report

**Generated:** 2026-02-19
**Sources cross-validated:**

1. `docs/services/*/technical.md` — Documented env vars (Configuration section)
2. `apps/*/src/index.ts` — REQUIRED_ENV arrays (startup fail-fast)
3. `terraform/environments/dev/main.tf` — Terraform-provided env_vars and secrets
4. `ecosystem.config.cjs` — Local dev configuration (COMMON_SERVICE_ENV, COMMON_SERVICE_URLS, SERVICE_ENV_MAPPINGS)

**Legend for comparison tables:**

| Symbol | Meaning         |
| ------ | --------------- |
| YES    | Present         |
| NO     | Missing         |
| OPT    | Optional access |
| N/A    | Not applicable  |

**Severity levels:**

| Level    | Meaning                                                                     |
| -------- | --------------------------------------------------------------------------- |
| CRITICAL | In REQUIRED_ENV but not in Terraform — startup probe failure on deploy      |
| HIGH     | In code but not documented, or naming inconsistency causing runtime failure |
| MEDIUM   | Documented but missing from ecosystem.config — local dev broken             |
| LOW      | Naming inconsistency, superfluous doc entry, or classification improvement  |

---

## Systemic Observations

### Terraform Architecture

All services inherit two shared blocks:

**`local.common_service_secrets`** (all services receive these as Terraform secrets):

- `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_SENTRY_DSN`
- `INTEXURAOS_ZAI_APP_API_KEY`, `INTEXURAOS_GEMINI_APP_API_KEY`
- `INTEXURAOS_DASH0_OTLP_ENDPOINT`, `INTEXURAOS_DASH0_AUTH_TOKEN`

**`local.common_service_env_vars`** (all services receive these as plain env vars):

- `INTEXURAOS_ENVIRONMENT`, `INTEXURAOS_GCP_PROJECT_ID`
- All 19 service URLs (`INTEXURAOS_*_URL` for all services)
- `INTEXURAOS_API_DOCS_HUB_URL`

**`COMMON_SERVICE_ENV`** in ecosystem.config covers:

- Auth vars, `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_GCP_PROJECT_ID`
- `INTEXURAOS_ZAI_APP_API_KEY`, `INTEXURAOS_GEMINI_APP_API_KEY`
- `INTEXURAOS_ENVIRONMENT`, `INTEXURAOS_WEB_APP_URL`
- `INTEXURAOS_DASH0_OTLP_ENDPOINT`, `INTEXURAOS_DASH0_AUTH_TOKEN`

**`COMMON_SERVICE_URLS`** in ecosystem.config covers all 19 service URLs.

Note: `INTEXURAOS_SENTRY_DSN` is in Terraform `common_service_secrets` but NOT in `COMMON_SERVICE_ENV`. In local dev it comes from `.envrc` via `...process.env` spread in `createServiceConfig`.

---

## Service-by-Service Analysis

### actions-agent

| Variable                                   | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue                                |
| ------------------------------------------ | ------------ | ---------------- | -------------------- | ---- | ------------------------------------ |
| `INTEXURAOS_GCP_PROJECT_ID`                | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK                                   |
| `INTEXURAOS_AUTH_JWKS_URL`                 | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                   |
| `INTEXURAOS_AUTH_ISSUER`                   | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                   |
| `INTEXURAOS_AUTH_AUDIENCE`                 | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                   |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`           | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                   |
| `INTEXURAOS_RESEARCH_AGENT_URL`            | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_USER_SERVICE_URL`              | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_COMMANDS_AGENT_URL`            | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_TODOS_AGENT_URL`               | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_NOTES_AGENT_URL`               | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_BOOKMARKS_AGENT_URL`           | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_CALENDAR_AGENT_URL`            | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_LINEAR_AGENT_URL`              | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_CODE_AGENT_URL`                | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`      | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                   |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                   |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                   |
| `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                   |
| `INTEXURAOS_WEB_APP_URL`                   | YES          | service env_vars | COMMON_SERVICE_ENV   | YES  | OK                                   |
| `INTEXURAOS_ZAI_APP_API_KEY`               | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW: documented but not REQUIRED_ENV |
| `INTEXURAOS_GEMINI_APP_API_KEY`            | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW: documented but not REQUIRED_ENV |

**Status: PASS** — All REQUIRED_ENV vars are covered by Terraform.

---

### api-docs-hub

api-docs-hub uses `REQUIRED_ENV_VARS` in `config.ts` (not in `index.ts`).

| Variable                                              | REQUIRED_ENV | Terraform        | ecosystem.config | Docs | Issue  |
| ----------------------------------------------------- | ------------ | ---------------- | ---------------- | ---- | ------ |
| `INTEXURAOS_USER_SERVICE_OPENAPI_URL`                 | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_NOTION_SERVICE_OPENAPI_URL`               | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL`             | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL` | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL`               | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL`               | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL`                | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL`          | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL`                | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_NOTES_AGENT_OPENAPI_URL`                  | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_TODOS_AGENT_OPENAPI_URL`                  | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL`         | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL`              | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL`               | YES          | service env_vars | NO               | YES  | MEDIUM |
| `INTEXURAOS_CHAT_AGENT_OPENAPI_URL`                   | YES          | service env_vars | NO               | YES  | MEDIUM |

**Status: WARN** — All required vars are in Terraform (no CRITICAL issues). 15 OPENAPI_URL vars are missing from ecosystem.config. api-docs-hub is not in the PM2 apps list, so this is acceptable — it requires manual setup when run locally.

---

### app-settings-service

| Variable                         | REQUIRED_ENV | Terraform       | ecosystem.config   | Docs | Issue                                |
| -------------------------------- | ------------ | --------------- | ------------------ | ---- | ------------------------------------ |
| `INTEXURAOS_GCP_PROJECT_ID`      | YES          | common_env_vars | COMMON_SERVICE_ENV | YES  | OK                                   |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK                                   |
| `INTEXURAOS_SENTRY_DSN`          | NO           | common_secrets  | envrc only         | YES  | LOW: documented but not REQUIRED_ENV |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### bookmarks-agent

| Variable                                | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs       | Issue                                                                            |
| --------------------------------------- | ------------ | ---------------- | -------------------- | ---------- | -------------------------------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`             | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES        | OK                                                                               |
| `INTEXURAOS_AUTH_JWKS_URL`              | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES        | OK                                                                               |
| `INTEXURAOS_AUTH_ISSUER`                | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES        | OK                                                                               |
| `INTEXURAOS_AUTH_AUDIENCE`              | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES        | OK                                                                               |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES        | OK                                                                               |
| `INTEXURAOS_WEB_AGENT_URL`              | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES        | OK                                                                               |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES        | OK                                                                               |
| `INTEXURAOS_PUBSUB_BOOKMARK_ENRICH`     | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES        | OK                                                                               |
| `INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE`  | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES        | OK                                                                               |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND`       | NO           | NO               | NO                   | YES (typo) | LOW: docs use truncated name — should be `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` |

**Status: PASS** — All REQUIRED_ENV vars covered. One doc naming error found.

---

### calendar-agent

| Variable                              | REQUIRED_ENV | Terraform       | ecosystem.config    | Docs | Issue                                       |
| ------------------------------------- | ------------ | --------------- | ------------------- | ---- | ------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | YES          | common_env_vars | COMMON_SERVICE_ENV  | YES  | OK                                          |
| `INTEXURAOS_AUTH_JWKS_URL`            | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                          |
| `INTEXURAOS_AUTH_ISSUER`              | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                          |
| `INTEXURAOS_AUTH_AUDIENCE`            | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                          |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                          |
| `INTEXURAOS_USER_SERVICE_URL`         | YES          | common_env_vars | COMMON_SERVICE_URLS | YES  | OK                                          |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | YES          | common_env_vars | COMMON_SERVICE_URLS | YES  | OK                                          |
| `INTEXURAOS_ZAI_APP_API_KEY`          | NO           | common_secrets  | COMMON_SERVICE_ENV  | YES  | LOW: in docs/Terraform but not REQUIRED_ENV |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | NO           | common_secrets  | COMMON_SERVICE_ENV  | YES  | LOW: in docs/Terraform but not REQUIRED_ENV |

**Status: PASS** — All REQUIRED_ENV vars covered. Calendar agent uses ZAI and Gemini keys but doesn't enforce them at startup (optional LLM path).

---

### chat-agent

| Variable                              | REQUIRED_ENV | Terraform       | ecosystem.config     | Docs | Issue                             |
| ------------------------------------- | ------------ | --------------- | -------------------- | ---- | --------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | YES          | common_env_vars | COMMON_SERVICE_ENV   | YES  | OK                                |
| `INTEXURAOS_AUTH_JWKS_URL`            | YES          | common_secrets  | COMMON_SERVICE_ENV   | YES  | OK                                |
| `INTEXURAOS_AUTH_ISSUER`              | YES          | common_secrets  | COMMON_SERVICE_ENV   | YES  | OK                                |
| `INTEXURAOS_AUTH_AUDIENCE`            | YES          | common_secrets  | COMMON_SERVICE_ENV   | YES  | OK                                |
| `INTEXURAOS_OPENAI_APP_API_KEY`       | YES          | service secrets | SERVICE_ENV_MAPPINGS | YES  | OK                                |
| `INTEXURAOS_USER_SERVICE_URL`         | YES          | common_env_vars | COMMON_SERVICE_URLS  | YES  | OK                                |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | YES          | common_secrets  | COMMON_SERVICE_ENV   | YES  | OK                                |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | YES          | common_env_vars | COMMON_SERVICE_URLS  | YES  | OK                                |
| `INTEXURAOS_ZAI_APP_API_KEY`          | YES          | common_secrets  | COMMON_SERVICE_ENV   | YES  | OK                                |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | NO           | common_secrets  | COMMON_SERVICE_ENV   | YES  | LOW: in docs but not REQUIRED_ENV |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### code-agent

| Variable                                | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue                                                                     |
| --------------------------------------- | ------------ | ---------------- | -------------------- | ---- | ------------------------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`             | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK                                                                        |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                        |
| `INTEXURAOS_WEBHOOK_VERIFY_SECRET`      | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                        |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`       | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                        |
| `INTEXURAOS_ORCHESTRATOR_SECRET`        | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                        |
| `INTEXURAOS_GITHUB_WEBHOOK_SECRET`      | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                        |
| `INTEXURAOS_SERVICE_URL`                | NO           | service env_vars | SERVICE_ENV_MAPPINGS | YES  | HIGH: in Terraform/docs/ecosystem but not REQUIRED_ENV                    |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` | NO           | service env_vars | SERVICE_ENV_MAPPINGS | YES  | HIGH: in Terraform/docs/ecosystem but not REQUIRED_ENV                    |
| `INTEXURAOS_AUTH_JWKS_URL`              | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | HIGH: used in auth middleware, in Terraform, documented, not REQUIRED_ENV |
| `INTEXURAOS_ACTIONS_AGENT_URL`          | NO           | common_env_vars  | COMMON_SERVICE_URLS  | YES  | LOW: documented as used but not REQUIRED_ENV                              |
| `INTEXURAOS_LINEAR_AGENT_URL`           | NO           | common_env_vars  | COMMON_SERVICE_URLS  | YES  | LOW: documented as used but not REQUIRED_ENV                              |
| `INTEXURAOS_WHATSAPP_SERVICE_URL`       | NO           | common_env_vars  | COMMON_SERVICE_URLS  | YES  | LOW: documented as used but not REQUIRED_ENV                              |

**Status: WARN** — No CRITICAL issues (all REQUIRED_ENV covered by Terraform). code-agent has minimal REQUIRED_ENV but actually uses many more vars at runtime. `INTEXURAOS_SERVICE_URL` and `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` are provided by Terraform but not fail-fast enforced.

---

### commands-agent

| Variable                              | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue |
| ------------------------------------- | ------------ | ---------------- | -------------------- | ---- | ----- |
| `INTEXURAOS_GCP_PROJECT_ID`           | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_JWKS_URL`            | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_ISSUER`              | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_AUDIENCE`            | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_USER_SERVICE_URL`         | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_ACTIONS_AGENT_URL`        | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`     | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_ZAI_APP_API_KEY`          | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW   |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW   |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### data-insights-agent

| Variable                                      | REQUIRED_ENV | Terraform       | ecosystem.config    | Docs | Issue |
| --------------------------------------------- | ------------ | --------------- | ------------------- | ---- | ----- |
| `INTEXURAOS_GCP_PROJECT_ID`                   | YES          | common_env_vars | COMMON_SERVICE_ENV  | YES  | OK    |
| `INTEXURAOS_AUTH_JWKS_URL`                    | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK    |
| `INTEXURAOS_AUTH_ISSUER`                      | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK    |
| `INTEXURAOS_AUTH_AUDIENCE`                    | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK    |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`              | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK    |
| `INTEXURAOS_USER_SERVICE_URL`                 | YES          | common_env_vars | COMMON_SERVICE_URLS | YES  | OK    |
| `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL` | YES          | common_env_vars | COMMON_SERVICE_URLS | YES  | OK    |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`         | YES          | common_env_vars | COMMON_SERVICE_URLS | YES  | OK    |
| `INTEXURAOS_ZAI_APP_API_KEY`                  | NO           | common_secrets  | COMMON_SERVICE_ENV  | YES  | LOW   |
| `INTEXURAOS_GEMINI_APP_API_KEY`               | NO           | common_secrets  | COMMON_SERVICE_ENV  | YES  | LOW   |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### image-service

| Variable                              | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue                                                                                       |
| ------------------------------------- | ------------ | ---------------- | -------------------- | ---- | ------------------------------------------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK                                                                                          |
| `INTEXURAOS_AUTH_JWKS_URL`            | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                          |
| `INTEXURAOS_AUTH_ISSUER`              | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                          |
| `INTEXURAOS_AUTH_AUDIENCE`            | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                          |
| `INTEXURAOS_USER_SERVICE_URL`         | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                                                                          |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                          |
| `INTEXURAOS_IMAGE_BUCKET`             | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                          |
| `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`    | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                          |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                                                                          |
| `INTEXURAOS_ZAI_APP_API_KEY`          | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW                                                                                         |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW                                                                                         |
| `INTEXURAOS_GUEST_ZAI_API_KEY`        | NO           | NO               | NO                   | YES  | HIGH: documented but not in Terraform, ecosystem.config, or REQUIRED_ENV — likely doc error |
| `INTEXURAOS_ZAI_API_KEY`              | NO           | NO               | NO                   | YES  | HIGH: likely doc error — should be `INTEXURAOS_ZAI_APP_API_KEY`                             |

**Status: WARN** — No CRITICAL issues. Two suspicious vars documented but not backed by any other source.

---

### linear-agent

| Variable                              | REQUIRED_ENV | Terraform       | ecosystem.config    | Docs | Issue                                                           |
| ------------------------------------- | ------------ | --------------- | ------------------- | ---- | --------------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | YES          | common_env_vars | COMMON_SERVICE_ENV  | NO   | HIGH: in REQUIRED_ENV but missing from docs Configuration table |
| `INTEXURAOS_AUTH_JWKS_URL`            | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                                              |
| `INTEXURAOS_AUTH_ISSUER`              | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                                              |
| `INTEXURAOS_AUTH_AUDIENCE`            | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                                              |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | YES          | common_secrets  | COMMON_SERVICE_ENV  | YES  | OK                                                              |
| `INTEXURAOS_USER_SERVICE_URL`         | YES          | common_env_vars | COMMON_SERVICE_URLS | YES  | OK                                                              |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | YES          | common_env_vars | COMMON_SERVICE_URLS | YES  | OK                                                              |
| `INTEXURAOS_ZAI_APP_API_KEY`          | NO           | common_secrets  | COMMON_SERVICE_ENV  | YES  | LOW                                                             |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | NO           | common_secrets  | COMMON_SERVICE_ENV  | YES  | LOW                                                             |

**Status: PASS** — All REQUIRED_ENV vars covered. `INTEXURAOS_GCP_PROJECT_ID` missing from documentation Configuration table.

---

### mobile-notifications-service

| Variable                         | REQUIRED_ENV | Terraform       | ecosystem.config   | Docs | Issue                                   |
| -------------------------------- | ------------ | --------------- | ------------------ | ---- | --------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`      | YES          | common_env_vars | COMMON_SERVICE_ENV | YES  | OK                                      |
| `INTEXURAOS_AUTH_JWKS_URL`       | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK                                      |
| `INTEXURAOS_AUTH_ISSUER`         | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK                                      |
| `INTEXURAOS_AUTH_AUDIENCE`       | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK                                      |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | NO           | common_secrets  | COMMON_SERVICE_ENV | YES  | LOW: documented but not in REQUIRED_ENV |
| `INTEXURAOS_SENTRY_DSN`          | NO           | common_secrets  | envrc only         | YES  | LOW                                     |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### notes-agent

| Variable                         | REQUIRED_ENV | Terraform       | ecosystem.config   | Docs | Issue |
| -------------------------------- | ------------ | --------------- | ------------------ | ---- | ----- |
| `INTEXURAOS_GCP_PROJECT_ID`      | YES          | common_env_vars | COMMON_SERVICE_ENV | YES  | OK    |
| `INTEXURAOS_AUTH_JWKS_URL`       | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK    |
| `INTEXURAOS_AUTH_ISSUER`         | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK    |
| `INTEXURAOS_AUTH_AUDIENCE`       | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK    |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK    |
| `INTEXURAOS_SENTRY_DSN`          | NO           | common_secrets  | envrc only         | YES  | LOW   |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### notion-service

| Variable                         | REQUIRED_ENV | Terraform       | ecosystem.config   | Docs | Issue                                |
| -------------------------------- | ------------ | --------------- | ------------------ | ---- | ------------------------------------ |
| `INTEXURAOS_GCP_PROJECT_ID`      | YES          | common_env_vars | COMMON_SERVICE_ENV | YES  | OK                                   |
| `INTEXURAOS_AUTH_JWKS_URL`       | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK                                   |
| `INTEXURAOS_AUTH_ISSUER`         | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK                                   |
| `INTEXURAOS_AUTH_AUDIENCE`       | YES          | common_secrets  | COMMON_SERVICE_ENV | YES  | OK                                   |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | NO           | common_secrets  | COMMON_SERVICE_ENV | YES  | LOW: documented but not REQUIRED_ENV |
| `INTEXURAOS_SENTRY_DSN`          | NO           | common_secrets  | envrc only         | YES  | LOW                                  |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### research-agent

| Variable                                   | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue                                                                |
| ------------------------------------------ | ------------ | ---------------- | -------------------- | ---- | -------------------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`                | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK                                                                   |
| `INTEXURAOS_AUTH_JWKS_URL`                 | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                   |
| `INTEXURAOS_AUTH_ISSUER`                   | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                   |
| `INTEXURAOS_AUTH_AUDIENCE`                 | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                   |
| `INTEXURAOS_USER_SERVICE_URL`              | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                                                   |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`           | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                   |
| `INTEXURAOS_WEB_APP_URL`                   | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                   |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`      | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                                                   |
| `INTEXURAOS_NOTION_SERVICE_URL`            | YES          | service env_vars | COMMON_SERVICE_URLS  | YES  | OK                                                                   |
| `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`         | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                   |
| `INTEXURAOS_IMAGE_SERVICE_URL`             | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                                                   |
| `INTEXURAOS_SHARE_BASE_URL`                | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                   |
| `INTEXURAOS_SHARED_CONTENT_BUCKET`         | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                   |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                   |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                   |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK                                                                   |
| `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`    | NO           | service env_vars | NO                   | NO   | HIGH: in Terraform but undocumented and absent from ecosystem.config |
| `INTEXURAOS_ZAI_APP_API_KEY`               | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW                                                                  |
| `INTEXURAOS_GEMINI_APP_API_KEY`            | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW                                                                  |
| `INTEXURAOS_GUEST_ZAI_API_KEY`             | NO           | NO               | NO                   | YES  | HIGH: documented but not in any other source                         |
| `INTEXURAOS_ZAI_API_KEY`                   | NO           | NO               | NO                   | YES  | HIGH: likely doc error — should be `INTEXURAOS_ZAI_APP_API_KEY`      |

**Status: WARN** — No CRITICAL issues. `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` is a live Terraform var with no documentation or ecosystem coverage.

---

### todos-agent

| Variable                              | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue |
| ------------------------------------- | ------------ | ---------------- | -------------------- | ---- | ----- |
| `INTEXURAOS_GCP_PROJECT_ID`           | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_JWKS_URL`            | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_ISSUER`              | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_AUDIENCE`            | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_TODOS_PROCESSING_TOPIC`   | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_USER_SERVICE_URL`         | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_ZAI_APP_API_KEY`          | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW   |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | NO           | common_secrets   | COMMON_SERVICE_ENV   | YES  | LOW   |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### user-service

| Variable                                | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue                                                                                                                |
| --------------------------------------- | ------------ | ---------------- | -------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`             | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK                                                                                                                   |
| `INTEXURAOS_AUTH0_DOMAIN`               | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                                                   |
| `INTEXURAOS_AUTH0_CLIENT_ID`            | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                                                   |
| `INTEXURAOS_AUTH_JWKS_URL`              | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                                                   |
| `INTEXURAOS_AUTH_ISSUER`                | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                                                   |
| `INTEXURAOS_AUTH_AUDIENCE`              | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                                                   |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`       | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                                                   |
| `INTEXURAOS_ENCRYPTION_KEY`             | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                                                   |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK                                                                                                                   |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`   | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK                                                                                                                   |
| `INTEXURAOS_WEB_APP_URL`                | YES          | service env_vars | COMMON_SERVICE_ENV   | YES  | OK                                                                                                                   |
| `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`     | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                                                   |
| `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET` | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK                                                                                                                   |
| `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI`  | NO           | service secrets  | NO                   | NO   | HIGH: in Terraform secrets and .envrc but missing from REQUIRED_ENV, ecosystem.config SERVICE_ENV_MAPPINGS, and docs |

**Status: WARN** — `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` is in Terraform service secrets and `.envrc` but not in REQUIRED_ENV, ecosystem.config, or documentation. In PM2 local dev, this arrives via `...process.env` spread from `.envrc`, which works but is implicit.

---

### web-agent

| Variable                              | REQUIRED_ENV | Terraform       | ecosystem.config     | Docs | Issue |
| ------------------------------------- | ------------ | --------------- | -------------------- | ---- | ----- |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | YES          | common_secrets  | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_CRAWL4AI_APP_API_KEY`     | YES          | service secrets | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_USER_SERVICE_URL`         | YES          | common_env_vars | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | YES          | common_env_vars | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_ZAI_APP_API_KEY`          | NO           | common_secrets  | COMMON_SERVICE_ENV   | YES  | LOW   |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | NO           | common_secrets  | COMMON_SERVICE_ENV   | YES  | LOW   |

**Status: PASS** — All REQUIRED_ENV vars covered.

---

### whatsapp-service

| Variable                                       | REQUIRED_ENV | Terraform        | ecosystem.config     | Docs | Issue |
| ---------------------------------------------- | ------------ | ---------------- | -------------------- | ---- | ----- |
| `INTEXURAOS_AUTH_JWKS_URL`                     | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_ISSUER`                       | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_AUTH_AUDIENCE`                     | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`               | YES          | common_secrets   | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_USER_SERVICE_URL`                  | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_GCP_PROJECT_ID`                    | YES          | common_env_vars  | COMMON_SERVICE_ENV   | YES  | OK    |
| `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`             | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_WHATSAPP_APP_SECRET`               | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_WHATSAPP_WABA_ID`                  | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID`          | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`             | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_WHATSAPP_MEDIA_BUCKET`             | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`        | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION` | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_SPEECHMATICS_APP_API_KEY`          | YES          | service secrets  | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_WEB_AGENT_URL`                     | YES          | common_env_vars  | COMMON_SERVICE_URLS  | YES  | OK    |
| `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`      | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`      | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`        | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`       | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`        | YES          | service env_vars | SERVICE_ENV_MAPPINGS | YES  | OK    |

**Status: PASS** — Full four-source alignment. whatsapp-service is the most comprehensively configured service.

---

## Worker Coverage

Workers don't use `REQUIRED_ENV` arrays — they use `getRequiredEnv()` (orchestrator) or access `process.env` directly (vm-lifecycle, log-cleanup).

### orchestrator (workers/orchestrator)

Env vars consumed in `start.ts`:

| Variable                                       | Usage          | .envrc | Docs | Issue                                                                                                |
| ---------------------------------------------- | -------------- | ------ | ---- | ---------------------------------------------------------------------------------------------------- |
| `INTEXURAOS_REPOSITORY_URL`                    | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_CODE_AGENT_URL`                    | getRequiredEnv | NO     | YES  | LOW: not in .envrc (derived from ecosystem), set in ecosystem.config                                 |
| `INTEXURAOS_ORCHESTRATOR_SECRET`               | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_GITHUB_APP_ID`                     | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_GITHUB_INSTALLATION_ID`            | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_PROJECT_ID`                        | getRequiredEnv | NO     | NO   | HIGH: uses `INTEXURAOS_PROJECT_ID`, not `INTEXURAOS_GCP_PROJECT_ID` — inconsistent and not in .envrc |
| `GOOGLE_APPLICATION_CREDENTIALS`               | getRequiredEnv | NO     | YES  | LOW: system credential, set externally                                                               |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`               | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_LINEAR_API_KEY`                    | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`                 | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_ZAI_APP_API_KEY`                   | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_GEMINI_APP_API_KEY`                | getRequiredEnv | YES    | YES  | OK                                                                                                   |
| `INTEXURAOS_GITHUB_APP_PRIVATE_KEY`            | OPT (fallback) | NO     | YES  | OK: fetched from GCP Secret Manager                                                                  |
| `INTEXURAOS_REPOSITORY_PATH`                   | getOptionalEnv | NO     | YES  | LOW: optional                                                                                        |
| `INTEXURAOS_WORKER_CAPACITY`                   | getOptionalEnv | NO     | NO   | LOW: optional, not documented                                                                        |
| `INTEXURAOS_CLAUDE_WORKER_IMAGE`               | getOptionalEnv | NO     | NO   | LOW: optional, not documented                                                                        |
| `INTEXURAOS_PRESERVE_FAILED_WORKER_CONTAINERS` | getOptionalEnv | NO     | NO   | LOW: optional debug flag                                                                             |
| `INTEXURAOS_COMPLETION_MAX_ATTEMPTS`           | getOptionalEnv | NO     | NO   | LOW: optional, not documented                                                                        |
| `INTEXURAOS_GIT_USER_NAME`                     | optional       | NO     | NO   | LOW: optional, falls back to git config                                                              |
| `INTEXURAOS_GIT_USER_EMAIL`                    | optional       | NO     | NO   | LOW: optional, falls back to git config                                                              |
| `PORT`                                         | getOptionalEnv | NO     | YES  | LOW: optional                                                                                        |
| `LOG_LEVEL`                                    | optional       | NO     | NO   | LOW: optional                                                                                        |
| `KEEP_CONTAINERS_ALIVE`                        | optional       | NO     | NO   | LOW: optional debug flag                                                                             |

### vm-lifecycle (workers/vm-lifecycle)

Cloud Function; env provided by Terraform.

| Variable                         | Terraform env_vars | Terraform secrets | .envrc | Docs |
| -------------------------------- | ------------------ | ----------------- | ------ | ---- |
| `INTEXURAOS_ENVIRONMENT`         | YES                | NO                | NO     | YES  |
| `INTEXURAOS_GCP_PROJECT_ID`      | YES                | NO                | YES    | YES  |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | NO                 | YES               | YES    | YES  |

### log-cleanup (workers/log-cleanup)

Cloud Function; env provided by Terraform.

| Variable                         | Terraform env_vars | Terraform secrets | Docs |
| -------------------------------- | ------------------ | ----------------- | ---- |
| `INTEXURAOS_ENVIRONMENT`         | YES                | NO                | YES  |
| `INTEXURAOS_GCP_PROJECT_ID`      | YES                | NO                | YES  |
| `INTEXURAOS_CODE_AGENT_URL`      | YES                | NO                | YES  |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | NO                 | YES               | YES  |

---

## Enhanced Checks

### Secrets Classification (Should Be in `secrets{}` Not `env_vars{}`)

All services correctly use Terraform `secrets{}` for sensitive values:

- API keys, tokens, client secrets → all in `common_service_secrets` or service `secrets` blocks
- Plain env_vars contain only URLs, project IDs, topic names, and environment name

**Status: PASS** — No secrets misclassified in `env_vars{}` blocks.

### Service URL Coverage in Terraform

All `INTEXURAOS_*_SERVICE_URL` and `INTEXURAOS_*_AGENT_URL` vars in `COMMON_SERVICE_URLS` (ecosystem.config) have corresponding entries in `local.common_service_env_vars` (Terraform).

Terraform has one extra URL not in ecosystem.config: `INTEXURAOS_API_DOCS_HUB_URL` — intentional, as api-docs-hub is not called by other services.

**Status: PASS** — Full URL coverage alignment.

### .envrc Coverage Check

Variables in `.envrc` not in any of the other 3 sources (or only partially covered):

| Variable                               | Terraform    | ecosystem.config | REQUIRED_ENV | Note                                          |
| -------------------------------------- | ------------ | ---------------- | ------------ | --------------------------------------------- |
| `PROJECT_ID`                           | NO           | NO               | NO           | Local shell shorthand only                    |
| `REGION`                               | NO           | NO               | NO           | Local shell shorthand only                    |
| `REGISTRY`                             | NO           | NO               | NO           | Local shell shorthand only                    |
| `INTEXURAOS_FIREBASE_API_KEY`          | YES (secret) | NO               | NO           | Web app only                                  |
| `INTEXURAOS_FIREBASE_AUTH_DOMAIN`      | YES (secret) | NO               | NO           | Web app only                                  |
| `INTEXURAOS_FIREBASE_PROJECT_ID`       | YES (secret) | NO               | NO           | Web app only                                  |
| `INTEXURAOS_AUTH0_SPA_CLIENT_ID`       | YES (secret) | NO               | NO           | Web app only                                  |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`         | YES (secret) | NO               | NO           | Orchestrator worker only                      |
| `INTEXURAOS_LINEAR_API_KEY`            | YES (secret) | NO               | NO           | Orchestrator worker only                      |
| `INTEXURAOS_GITHUB_APP_ID`             | YES (secret) | NO               | NO           | Orchestrator worker only                      |
| `INTEXURAOS_GITHUB_INSTALLATION_ID`    | YES (secret) | NO               | NO           | Orchestrator worker only                      |
| `INTEXURAOS_REPOSITORY_URL`            | YES (secret) | NO               | NO           | Orchestrator worker only                      |
| `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` | YES (secret) | NO               | NO           | user-service; implicit via process.env spread |

---

## Consolidated Issue List

### CRITICAL Issues (Startup Probe Failures)

None found. All REQUIRED_ENV vars are covered by Terraform.

### HIGH Issues

| ID  | Service/Worker                | Variable                                | Description                                                                                                                                                                                                              |
| --- | ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | orchestrator                  | `INTEXURAOS_PROJECT_ID`                 | `start.ts` calls `getRequiredEnv('INTEXURAOS_PROJECT_ID')` but `.envrc` exports `INTEXURAOS_GCP_PROJECT_ID`. Different names. Orchestrator will fail at startup unless `INTEXURAOS_PROJECT_ID` is set in `.envrc.local`. |
| H2  | research-agent                | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` | Present in Terraform env_vars for research-agent but missing from docs and ecosystem.config SERVICE_ENV_MAPPINGS. Undocumented live dependency.                                                                          |
| H3  | user-service                  | `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI`  | In Terraform service secrets and `.envrc`, not in ecosystem.config user-service section or docs. Relies on implicit `...process.env` spread in PM2 config.                                                               |
| H4  | image-service                 | `INTEXURAOS_GUEST_ZAI_API_KEY`          | Documented in technical.md but not in Terraform, ecosystem.config, or REQUIRED_ENV. Likely stale or erroneous doc entry.                                                                                                 |
| H5  | image-service, research-agent | `INTEXURAOS_ZAI_API_KEY`                | Documented but doesn't match the actual key name `INTEXURAOS_ZAI_APP_API_KEY`. Documentation naming error.                                                                                                               |
| H6  | linear-agent                  | `INTEXURAOS_GCP_PROJECT_ID`             | In REQUIRED_ENV and Terraform but missing from documentation Configuration table.                                                                                                                                        |

### MEDIUM Issues

| ID  | Service      | Description                                                                                                                                                                          |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | api-docs-hub | All 15 `*_OPENAPI_URL` vars absent from ecosystem.config. Service cannot be run locally via PM2 without manual env setup. Acceptable since api-docs-hub is not in the PM2 apps list. |

### LOW Issues

| ID  | Service                                      | Variable                                                      | Description                                                                                                                                                                   |
| --- | -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | bookmarks-agent                              | `INTEXURAOS_PUBSUB_WHATSAPP_SEND`                             | Documentation uses truncated var name — should be `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`.                                                                                    |
| L2  | multiple services                            | `INTEXURAOS_ZAI_APP_API_KEY`, `INTEXURAOS_GEMINI_APP_API_KEY` | Documented and in Terraform but not REQUIRED_ENV for several services that use these keys at runtime (calendar-agent, commands-agent, data-insights-agent, todos-agent).      |
| L3  | orchestrator                                 | Optional vars                                                 | `INTEXURAOS_WORKER_CAPACITY`, `INTEXURAOS_CLAUDE_WORKER_IMAGE`, `INTEXURAOS_PRESERVE_FAILED_WORKER_CONTAINERS`, `INTEXURAOS_COMPLETION_MAX_ATTEMPTS` not documented anywhere. |
| L4  | mobile-notifications-service, notion-service | `INTEXURAOS_INTERNAL_AUTH_TOKEN`                              | Documented as required but not in REQUIRED_ENV (optional enforcement).                                                                                                        |
| L5  | user-service                                 | `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI`                        | Works via process.env spread but should be explicit in ecosystem.config user-service section.                                                                                 |

---

## Summary

| Severity | Count | Status |
| -------- | ----- | ------ |
| CRITICAL | 0     | PASS   |
| HIGH     | 6     | WARN   |
| MEDIUM   | 1     | INFO   |
| LOW      | 5     | INFO   |

### Key Conclusions

**No deployment-blocking issues.** Zero CRITICAL findings — every var in every REQUIRED*ENV array is backed by Terraform coverage (either via `common_service_secrets`, `common_service_env_vars`, or service-specific `secrets`/`env_vars` blocks). The `common_service*\*` blocks are the core scaling mechanism.

**Orchestrator naming inconsistency is highest-priority (H1).** `INTEXURAOS_PROJECT_ID` vs `INTEXURAOS_GCP_PROJECT_ID` is the only issue that could cause an immediate runtime failure if the orchestrator is started on a new machine without `.envrc.local` configuration.

**Documentation has spurious API key entries (H4, H5).** Both image-service and research-agent document `INTEXURAOS_GUEST_ZAI_API_KEY` and `INTEXURAOS_ZAI_API_KEY` — neither exists in Terraform or ecosystem.config. These are likely remnants of an earlier API key naming scheme before the `_APP_` suffix was standardized.

**Secrets classification is correct throughout.** All sensitive vars (API keys, tokens, client secrets) are properly in Terraform `secrets{}` blocks. No secrets found in plain `env_vars{}`.

**URL coverage is complete.** All 19 service URLs in ecosystem.config `COMMON_SERVICE_URLS` have corresponding entries in Terraform `common_service_env_vars`.
