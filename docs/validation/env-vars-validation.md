# Environment Variables Cross-Validation Report

**Generated:** 2026-03-16
**Sources cross-validated:**

1. `docs/services/*/technical.md` — Documented env vars (Configuration section)
2. `apps/*/src/index.ts` — REQUIRED_ENV arrays (startup fail-fast)
3. `terraform/environments/dev/main.tf` — Terraform-provided env_vars and secrets
4. `ecosystem.config.cjs` — Local dev configuration (COMMON_SERVICE_ENV, COMMON_SERVICE_URLS, SERVICE_ENV_MAPPINGS)

**Scope:** code-agent, orchestrator, whatsapp-service, research-agent, user-service, commands-agent, actions-agent

**Legend for comparison tables:**

| Symbol | Meaning                                     |
| ------ | ------------------------------------------- |
| YES    | Present                                     |
| NO     | Missing                                     |
| OPT    | Optional — accessed but not in REQUIRED_ENV |
| N/A    | Not applicable to this service              |

**Severity levels:**

| Level    | Meaning                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| CRITICAL | In REQUIRED_ENV but absent from Terraform — startup probe failure on deploy   |
| HIGH     | In code but not documented, or naming inconsistency causing runtime failure   |
| MEDIUM   | Documented but missing from ecosystem.config — local dev broken               |
| LOW      | Naming inconsistency, superfluous doc entry, or classification improvement    |

---

## Systemic Observations

### Terraform Architecture

All services inherit two shared blocks:

**`local.common_service_secrets`** (all services receive these via Terraform secrets):

- `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_SENTRY_DSN`
- `INTEXURAOS_MINIMAX_APP_API_KEY`, `INTEXURAOS_GEMINI_APP_API_KEY`, `INTEXURAOS_DASHSCOPE_APP_API_KEY`
- `INTEXURAOS_DASH0_OTLP_ENDPOINT`, `INTEXURAOS_DASH0_AUTH_TOKEN`

**`local.common_service_env_vars`** (all services receive these as plain env vars):

- `INTEXURAOS_ENVIRONMENT`, `INTEXURAOS_GCP_PROJECT_ID`
- All service URLs: `INTEXURAOS_USER_SERVICE_URL`, `INTEXURAOS_ACTIONS_AGENT_URL`, `INTEXURAOS_RESEARCH_AGENT_URL`, `INTEXURAOS_COMMANDS_AGENT_URL`, `INTEXURAOS_NOTES_AGENT_URL`, `INTEXURAOS_TODOS_AGENT_URL`, `INTEXURAOS_BOOKMARKS_AGENT_URL`, `INTEXURAOS_CODE_AGENT_URL`, `INTEXURAOS_APP_SETTINGS_SERVICE_URL`, `INTEXURAOS_CALENDAR_AGENT_URL`, `INTEXURAOS_WEB_AGENT_URL`, `INTEXURAOS_LINEAR_AGENT_URL`, `INTEXURAOS_CHAT_AGENT_URL`, `INTEXURAOS_NOTION_SERVICE_URL`, `INTEXURAOS_WHATSAPP_SERVICE_URL`, `INTEXURAOS_IMAGE_SERVICE_URL`, `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL`, `INTEXURAOS_DATA_INSIGHTS_AGENT_URL`, `INTEXURAOS_API_DOCS_HUB_URL`

**`ecosystem.config.cjs` common blocks:**

- `COMMON_SERVICE_ENV`: mirrors `common_service_secrets` (auth vars, GCP project, API keys, DASH0)
- `COMMON_SERVICE_URLS`: mirrors `common_service_env_vars` service URLs (localhost ports for dev)
- `SERVICE_ENV_MAPPINGS[service]`: per-service Pub/Sub topics and non-URL config

### Systemic Auth Var Pattern (Confirmed)

Auth vars `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, and `INTEXURAOS_AUTH_AUDIENCE` are present in `common_service_secrets` (Terraform) and `COMMON_SERVICE_ENV` (ecosystem), so they are provided to all services at runtime. However, most services' `REQUIRED_ENV` arrays and technical docs either include them explicitly or omit them depending on the service:

- **code-agent**: auth vars are in `PRODUCTION_ONLY_ENV` (not `REQUIRED_ENV`) — present in Terraform, **absent from the Configuration table in docs** (they appear only in the optional comment block)
- **whatsapp-service, research-agent, user-service, commands-agent, actions-agent**: auth vars are in `REQUIRED_ENV` and documented — consistent

The pattern is only a documentation gap for **code-agent** (see details below), not a runtime issue.

---

## Service-by-Service Analysis

---

### code-agent

**Source:** `apps/code-agent/src/index.ts`

`REQUIRED_ENV` (always validated):
- `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_WEBHOOK_VERIFY_SECRET`, `INTEXURAOS_TOKEN_ENCRYPTION_KEY`, `INTEXURAOS_ORCHESTRATOR_SECRET`, `INTEXURAOS_GITHUB_WEBHOOK_SECRET`, `INTEXURAOS_SERVICE_URL`

`PRODUCTION_ONLY_ENV` (validated unless `E2E_MODE=true`):
- `INTEXURAOS_WHATSAPP_SERVICE_URL`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, `INTEXURAOS_LINEAR_AGENT_URL`, `INTEXURAOS_ACTIONS_AGENT_URL`, `INTEXURAOS_AUTH_AUDIENCE`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_USER_SERVICE_URL`, `INTEXURAOS_GEMINI_APP_API_KEY`

Optional (comment only): `E2E_MODE`, `E2E_TEST_USER_ID`, `INTEXURAOS_WEB_URL`, `INTEXURAOS_SENTRY_DSN`, `INTEXURAOS_ENVIRONMENT`

#### Terraform provision (code-agent)

| Variable                                | Source                                     | Provided |
| --------------------------------------- | ------------------------------------------ | -------- |
| `INTEXURAOS_GCP_PROJECT_ID`             | common_service_env_vars                    | YES      |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | common_service_secrets                     | YES      |
| `INTEXURAOS_WEBHOOK_VERIFY_SECRET`      | code-agent secrets block                   | YES      |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`       | code-agent secrets block                   | YES      |
| `INTEXURAOS_ORCHESTRATOR_SECRET`        | code-agent secrets block                   | YES      |
| `INTEXURAOS_GITHUB_WEBHOOK_SECRET`      | code-agent secrets block                   | YES      |
| `INTEXURAOS_SERVICE_URL`                | code-agent env_vars block                  | YES      |
| `INTEXURAOS_WHATSAPP_SERVICE_URL`       | common_service_env_vars                    | YES      |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` | code-agent env_vars block                  | YES      |
| `INTEXURAOS_LINEAR_AGENT_URL`           | common_service_env_vars                    | YES      |
| `INTEXURAOS_ACTIONS_AGENT_URL`          | common_service_env_vars                    | YES      |
| `INTEXURAOS_AUTH_AUDIENCE`              | common_service_secrets                     | YES      |
| `INTEXURAOS_AUTH_ISSUER`                | common_service_secrets                     | YES      |
| `INTEXURAOS_AUTH_JWKS_URL`              | common_service_secrets                     | YES      |
| `INTEXURAOS_USER_SERVICE_URL`           | common_service_env_vars                    | YES      |
| `INTEXURAOS_GEMINI_APP_API_KEY`         | common_service_secrets                     | YES      |
| `INTEXURAOS_SENTRY_DSN`                 | common_service_secrets                     | YES      |
| `INTEXURAOS_WEB_URL`                    | **NOT in Terraform**                       | NO       |

#### ecosystem.config.cjs (code-agent)

The `SERVICE_ENV_MAPPINGS['code-agent']` block provides:
- `INTEXURAOS_SERVICE_URL` (hardcoded), `INTEXURAOS_WEBHOOK_VERIFY_SECRET`, `INTEXURAOS_ORCHESTRATOR_SECRET`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, `INTEXURAOS_TOKEN_ENCRYPTION_KEY`, `INTEXURAOS_GITHUB_WEBHOOK_SECRET`, queue sizing vars

All auth vars, service URLs, and GCP project come from `COMMON_SERVICE_ENV` / `COMMON_SERVICE_URLS`.

`E2E_MODE` is **not set** in ecosystem.config.cjs, so the production validation path runs in local dev (requiring all `PRODUCTION_ONLY_ENV` vars to be present in the environment).

#### Cross-validation findings (code-agent)

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOW      | `INTEXURAOS_WEB_URL` is listed as Optional in code comments and docs, but is absent from Terraform. Since it has a default (`https://intexuraos.cloud`) this is acceptable at runtime, but the docs Configuration table does not make the default value explicit.                                                                                                                   |
| LOW      | Auth vars (`INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`) are in `PRODUCTION_ONLY_ENV` in code, but the docs Configuration table only notes them as "Production" required. The docs are correct but the REQUIRED/Production categorization in the code comment block is slightly misleading (they appear in optional comment, not in the table). |
| LOW      | `INTEXURAOS_QUEUE_MAX_SIZE`, `INTEXURAOS_QUEUE_TTL_MINUTES`, `INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS`, `INTEXURAOS_RETRY_QUEUE_TTL_MINUTES` are present in Terraform and ecosystem with defaults, but are **not documented** in the Configuration table in `docs/services/code-agent/technical.md`.                                                                                    |

---

### orchestrator

**Source:** Orchestrator does not live in `apps/` — it is a local machine service. No `src/index.ts` with `REQUIRED_ENV`. Configuration is documented in `docs/services/orchestrator/technical.md` and injected at runtime on each worker machine.

Not included in Terraform Cloud Run modules (by design — runs locally).
Not included in ecosystem.config.cjs (local machine service).

**Validation:** Cannot cross-validate via the three-source method. Orchestrator docs Configuration table is the sole source of truth. No gaps are detectable without live worker inspection.

---

### whatsapp-service

**Source:** `apps/whatsapp-service/src/index.ts`

`REQUIRED_ENV`:
- `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_USER_SERVICE_URL`, `INTEXURAOS_GCP_PROJECT_ID`
- `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`, `INTEXURAOS_WHATSAPP_APP_SECRET`, `INTEXURAOS_WHATSAPP_WABA_ID`, `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID`, `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`, `INTEXURAOS_WHATSAPP_MEDIA_BUCKET`
- `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`, `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION`
- `INTEXURAOS_WEB_AGENT_URL`
- `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`, `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`, `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC`, `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`

#### Terraform provision (whatsapp-service)

| Variable                                       | Source                      | Provided |
| ---------------------------------------------- | --------------------------- | -------- |
| `INTEXURAOS_AUTH_JWKS_URL`                     | common_service_secrets      | YES      |
| `INTEXURAOS_AUTH_ISSUER`                       | common_service_secrets      | YES      |
| `INTEXURAOS_AUTH_AUDIENCE`                     | common_service_secrets      | YES      |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`               | common_service_secrets      | YES      |
| `INTEXURAOS_USER_SERVICE_URL`                  | common_service_env_vars     | YES      |
| `INTEXURAOS_GCP_PROJECT_ID`                    | common_service_env_vars     | YES      |
| `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`             | whatsapp-service secrets    | YES      |
| `INTEXURAOS_WHATSAPP_APP_SECRET`               | whatsapp-service secrets    | YES      |
| `INTEXURAOS_WHATSAPP_WABA_ID`                  | whatsapp-service secrets    | YES      |
| `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID`          | whatsapp-service secrets    | YES      |
| `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`             | whatsapp-service secrets    | YES      |
| `INTEXURAOS_WHATSAPP_MEDIA_BUCKET`             | whatsapp-service env_vars   | YES      |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`        | whatsapp-service env_vars   | YES      |
| `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION` | whatsapp-service env_vars   | YES      |
| `INTEXURAOS_WEB_AGENT_URL`                     | common_service_env_vars     | YES      |
| `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`      | whatsapp-service env_vars   | YES      |
| `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC`      | whatsapp-service env_vars   | YES      |
| `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC`         | whatsapp-service env_vars   | YES      |
| `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`       | whatsapp-service env_vars   | YES      |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`        | whatsapp-service env_vars   | YES      |

#### ecosystem.config.cjs (whatsapp-service)

`SERVICE_ENV_MAPPINGS['whatsapp-service']` provides all Pub/Sub topics and WhatsApp-specific vars with defaults. Auth vars come from `COMMON_SERVICE_ENV`. `INTEXURAOS_WEB_AGENT_URL` comes from `COMMON_SERVICE_URLS`.

Note: ecosystem adds `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` (with default `whatsapp-send-message-sub`) which is **not present in Terraform** and **not in REQUIRED_ENV**. This is used internally but not documented.

#### Cross-validation findings (whatsapp-service)

| Severity | Finding                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOW      | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` appears in ecosystem.config.cjs with a default value, but is absent from Terraform and the docs Configuration table. If it is used at runtime in local dev only, this is acceptable, but it should be documented as optional. |
| NONE     | All `REQUIRED_ENV` vars are satisfied in Terraform and ecosystem. Auth vars pattern is correctly documented.                                                                                                                                                                 |

---

### research-agent

**Source:** `apps/research-agent/src/index.ts`

`REQUIRED_ENV`:
- `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_USER_SERVICE_URL`, `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- `INTEXURAOS_WEB_APP_URL`, `INTEXURAOS_APP_SETTINGS_SERVICE_URL`, `INTEXURAOS_NOTION_SERVICE_URL`
- `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`, `INTEXURAOS_IMAGE_SERVICE_URL`
- `INTEXURAOS_SHARE_BASE_URL`, `INTEXURAOS_SHARED_CONTENT_BUCKET`
- `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC`, `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`

#### Terraform provision (research-agent)

| Variable                                   | Source                                                 | Provided        |
| ------------------------------------------ | ------------------------------------------------------ | --------------- |
| `INTEXURAOS_GCP_PROJECT_ID`                | common_service_env_vars                                | YES             |
| `INTEXURAOS_AUTH_JWKS_URL`                 | common_service_secrets                                 | YES             |
| `INTEXURAOS_AUTH_ISSUER`                   | common_service_secrets                                 | YES             |
| `INTEXURAOS_AUTH_AUDIENCE`                 | common_service_secrets                                 | YES             |
| `INTEXURAOS_USER_SERVICE_URL`              | common_service_env_vars                                | YES             |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`           | common_service_secrets                                 | YES             |
| `INTEXURAOS_WEB_APP_URL`                   | research-agent env_vars block                          | YES             |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`      | common_service_env_vars                                | YES             |
| `INTEXURAOS_NOTION_SERVICE_URL`            | common_service_env_vars **and** research-agent block   | YES (redundant) |
| `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`         | research-agent env_vars block                          | YES             |
| `INTEXURAOS_IMAGE_SERVICE_URL`             | common_service_env_vars                                | YES             |
| `INTEXURAOS_SHARE_BASE_URL`                | research-agent env_vars block                          | YES             |
| `INTEXURAOS_SHARED_CONTENT_BUCKET`         | research-agent env_vars block                          | YES             |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | research-agent env_vars block                          | YES             |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | research-agent env_vars block                          | YES             |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | research-agent env_vars block                          | YES             |

Additional Terraform-only vars (not in REQUIRED_ENV, not documented):
- `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` — present in Terraform env_vars, absent from REQUIRED_ENV and docs Configuration table.

#### ecosystem.config.cjs (research-agent)

`SERVICE_ENV_MAPPINGS['research-agent']` provides: `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`, `INTEXURAOS_SHARED_CONTENT_BUCKET`, `INTEXURAOS_SHARE_BASE_URL`, `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC`, `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`. `INTEXURAOS_WEB_APP_URL` comes from `COMMON_SERVICE_ENV`.

Missing from ecosystem SERVICE_ENV_MAPPINGS (but present in COMMON_SERVICE_URLS or COMMON_SERVICE_ENV):
- `INTEXURAOS_NOTION_SERVICE_URL` — in `COMMON_SERVICE_URLS` YES
- `INTEXURAOS_IMAGE_SERVICE_URL` — in `COMMON_SERVICE_URLS` YES
- `INTEXURAOS_APP_SETTINGS_SERVICE_URL` — in `COMMON_SERVICE_URLS` YES

#### Cross-validation findings (research-agent)

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOW      | `INTEXURAOS_NOTION_SERVICE_URL` is set twice in Terraform for research-agent: once in `common_service_env_vars` and again explicitly in the `research_agent` env_vars block (line 1072). The explicit value uses `module.notion_service.service_url` (a module reference) while the common block uses a string interpolation. The module reference form takes precedence (last-write-wins in Terraform merge). This is a redundancy, not a bug, but should be cleaned up. |
| LOW      | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` is provisioned in Terraform but is absent from `REQUIRED_ENV`, absent from the docs Configuration table, and absent from ecosystem.config.cjs. If used at runtime, this is an undocumented required var.                                                                                                                                                                                                                          |

---

### user-service

**Source:** `apps/user-service/src/index.ts`

`REQUIRED_ENV`:
- `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_AUTH0_DOMAIN`, `INTEXURAOS_AUTH0_CLIENT_ID`
- `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_TOKEN_ENCRYPTION_KEY`, `INTEXURAOS_ENCRYPTION_KEY`, `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- `INTEXURAOS_APP_SETTINGS_SERVICE_URL`, `INTEXURAOS_WEB_APP_URL`
- `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`, `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET`
- `INTEXURAOS_GITHUB_OAUTH_CLIENT_ID`, `INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET`

Optional (accessed but not in REQUIRED_ENV): `INTEXURAOS_SENTRY_DSN`, `INTEXURAOS_ENVIRONMENT`, `INTEXURAOS_DASH0_OTLP_ENDPOINT`

#### Terraform provision (user-service)

| Variable                                | Source                         | Provided |
| --------------------------------------- | ------------------------------ | -------- |
| `INTEXURAOS_GCP_PROJECT_ID`             | common_service_env_vars        | YES      |
| `INTEXURAOS_AUTH0_DOMAIN`               | user-service secrets block     | YES      |
| `INTEXURAOS_AUTH0_CLIENT_ID`            | user-service secrets block     | YES      |
| `INTEXURAOS_AUTH_JWKS_URL`              | common_service_secrets         | YES      |
| `INTEXURAOS_AUTH_ISSUER`                | common_service_secrets         | YES      |
| `INTEXURAOS_AUTH_AUDIENCE`              | common_service_secrets         | YES      |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`       | user-service secrets block     | YES      |
| `INTEXURAOS_ENCRYPTION_KEY`             | user-service secrets block     | YES      |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | common_service_secrets         | YES      |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`   | common_service_env_vars        | YES      |
| `INTEXURAOS_WEB_APP_URL`                | user-service env_vars block    | YES      |
| `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`     | user-service secrets block     | YES      |
| `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET` | user-service secrets block     | YES      |
| `INTEXURAOS_GITHUB_OAUTH_CLIENT_ID`     | user-service secrets block     | YES      |
| `INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET` | user-service secrets block     | YES      |
| `INTEXURAOS_SENTRY_DSN`                 | common_service_secrets         | YES      |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT`        | common_service_secrets         | YES      |

Terraform-only (not in REQUIRED_ENV):
- `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` — present in Terraform secrets block, absent from REQUIRED_ENV. Not referenced in user-service source code (likely constructed from `INTEXURAOS_WEB_APP_URL` at runtime). The Terraform secret exists to allow override of the callback URL.

#### ecosystem.config.cjs (user-service)

`SERVICE_ENV_MAPPINGS['user-service']` provides: `INTEXURAOS_TOKEN_ENCRYPTION_KEY`, `INTEXURAOS_ENCRYPTION_KEY`, `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`, `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET`, `INTEXURAOS_GITHUB_OAUTH_CLIENT_ID`, `INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET`.

`INTEXURAOS_AUTH0_DOMAIN` and `INTEXURAOS_AUTH0_CLIENT_ID` come from `COMMON_SERVICE_ENV`. `INTEXURAOS_WEB_APP_URL` comes from `COMMON_SERVICE_ENV`. All service URLs come from `COMMON_SERVICE_URLS`.

#### Cross-validation findings (user-service)

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOW      | `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` is provisioned in Terraform but absent from REQUIRED_ENV, absent from docs Configuration table, and not directly referenced in user-service source code. If the service constructs the redirect URI from `INTEXURAOS_WEB_APP_URL`, the Terraform secret is either unused or a legacy artifact. Should be documented as optional or removed from Terraform. |
| LOW      | `INTEXURAOS_DASH0_AUTH_TOKEN` is in `common_service_secrets` (Terraform) but not documented in the user-service Configuration table. It is documented in the infrastructure section. The docs omit it under Configuration.                                                                                                                                                                        |
| NONE     | All `REQUIRED_ENV` vars are satisfied in both Terraform and ecosystem. No startup-blocker gaps.                                                                                                                                                                                                                                                                                                   |

---

### commands-agent

**Source:** `apps/commands-agent/src/index.ts`

`REQUIRED_ENV`:
- `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_USER_SERVICE_URL`, `INTEXURAOS_ACTIONS_AGENT_URL`, `INTEXURAOS_APP_SETTINGS_SERVICE_URL`
- `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`

Optional: `INTEXURAOS_SENTRY_DSN`, `INTEXURAOS_ENVIRONMENT`, `INTEXURAOS_GEMINI_APP_API_KEY` (platform fallback)

#### Terraform provision (commands-agent)

| Variable                              | Source                      | Provided  |
| ------------------------------------- | --------------------------- | --------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | common_service_env_vars     | YES       |
| `INTEXURAOS_AUTH_JWKS_URL`            | common_service_secrets      | YES       |
| `INTEXURAOS_AUTH_ISSUER`              | common_service_secrets      | YES       |
| `INTEXURAOS_AUTH_AUDIENCE`            | common_service_secrets      | YES       |
| `INTEXURAOS_USER_SERVICE_URL`         | common_service_env_vars     | YES       |
| `INTEXURAOS_ACTIONS_AGENT_URL`        | common_service_env_vars     | YES       |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | common_service_env_vars     | YES       |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | common_service_secrets      | YES       |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`     | commands-agent env_vars     | YES       |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | common_service_secrets      | YES (opt) |
| `INTEXURAOS_SENTRY_DSN`               | common_service_secrets      | YES (opt) |

#### ecosystem.config.cjs (commands-agent)

`SERVICE_ENV_MAPPINGS['commands-agent']` provides only `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`. All auth vars, service URLs, and GCP project come from `COMMON_SERVICE_ENV` / `COMMON_SERVICE_URLS`.

#### Cross-validation findings (commands-agent)

| Severity | Finding                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| NONE     | All `REQUIRED_ENV` vars satisfied in Terraform and ecosystem. Auth vars correctly documented. Configuration table in docs is complete and accurate. |

---

### actions-agent

**Source:** `apps/actions-agent/src/index.ts`

`REQUIRED_ENV`:
- `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_RESEARCH_AGENT_URL`, `INTEXURAOS_USER_SERVICE_URL`, `INTEXURAOS_COMMANDS_AGENT_URL`
- `INTEXURAOS_TODOS_AGENT_URL`, `INTEXURAOS_NOTES_AGENT_URL`, `INTEXURAOS_BOOKMARKS_AGENT_URL`
- `INTEXURAOS_CALENDAR_AGENT_URL`, `INTEXURAOS_LINEAR_AGENT_URL`, `INTEXURAOS_CODE_AGENT_URL`
- `INTEXURAOS_APP_SETTINGS_SERVICE_URL`, `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, `INTEXURAOS_WEB_APP_URL`

Optional: `INTEXURAOS_SENTRY_DSN`, `INTEXURAOS_GEMINI_APP_API_KEY`

#### Terraform provision (actions-agent)

| Variable                                | Source                      | Provided  |
| --------------------------------------- | --------------------------- | --------- |
| `INTEXURAOS_GCP_PROJECT_ID`             | common_service_env_vars     | YES       |
| `INTEXURAOS_AUTH_JWKS_URL`              | common_service_secrets      | YES       |
| `INTEXURAOS_AUTH_ISSUER`                | common_service_secrets      | YES       |
| `INTEXURAOS_AUTH_AUDIENCE`              | common_service_secrets      | YES       |
| `INTEXURAOS_RESEARCH_AGENT_URL`         | common_service_env_vars     | YES       |
| `INTEXURAOS_USER_SERVICE_URL`           | common_service_env_vars     | YES       |
| `INTEXURAOS_COMMANDS_AGENT_URL`         | common_service_env_vars     | YES       |
| `INTEXURAOS_TODOS_AGENT_URL`            | common_service_env_vars     | YES       |
| `INTEXURAOS_NOTES_AGENT_URL`            | common_service_env_vars     | YES       |
| `INTEXURAOS_BOOKMARKS_AGENT_URL`        | common_service_env_vars     | YES       |
| `INTEXURAOS_CALENDAR_AGENT_URL`         | common_service_env_vars     | YES       |
| `INTEXURAOS_LINEAR_AGENT_URL`           | common_service_env_vars     | YES       |
| `INTEXURAOS_CODE_AGENT_URL`             | common_service_env_vars     | YES       |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`   | common_service_env_vars     | YES       |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | common_service_secrets      | YES       |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`       | actions-agent env_vars      | YES       |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` | actions-agent env_vars      | YES       |
| `INTEXURAOS_WEB_APP_URL`                | actions-agent env_vars      | YES       |
| `INTEXURAOS_GEMINI_APP_API_KEY`         | common_service_secrets      | YES (opt) |

Terraform-only (not in REQUIRED_ENV, not in docs):
- `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` — in Terraform and ecosystem but absent from REQUIRED_ENV and docs Configuration table.

#### ecosystem.config.cjs (actions-agent)

`SERVICE_ENV_MAPPINGS['actions-agent']` provides: `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC`, `INTEXURAOS_WEB_APP_URL`. All auth vars and service URLs come from `COMMON_SERVICE_ENV` / `COMMON_SERVICE_URLS`.

#### Cross-validation findings (actions-agent)

| Severity | Finding                                                                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOW      | `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` is provisioned in Terraform and present in ecosystem.config.cjs but is absent from `REQUIRED_ENV` in `index.ts` and absent from the docs Configuration table. If this topic is used at runtime, it is an undocumented optional var that should appear in the Configuration table. |
| NONE     | All `REQUIRED_ENV` vars satisfied in Terraform and ecosystem. No startup-blocker gaps.                                                                                                                                                                                                                                       |

---

## Consolidated Findings

### No CRITICAL findings

No service has a variable in `REQUIRED_ENV` that is missing from Terraform. All services will start successfully on Cloud Run deployment.

### Summary by severity

| Severity | Count | Findings        |
| -------- | ----- | --------------- |
| CRITICAL | 0     | —               |
| HIGH     | 0     | —               |
| MEDIUM   | 0     | —               |
| LOW      | 8     | See table below |

### All LOW findings

| #   | Service          | Variable                                       | Issue                                                                                                                      |
| --- | ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | code-agent       | `INTEXURAOS_WEB_URL`                           | Optional var with default not in Terraform; default value not explicit in docs Configuration table                         |
| 2   | code-agent       | Auth vars (3)                                  | In `PRODUCTION_ONLY_ENV` but docs Configuration table correctly lists them; comment block is misleading                    |
| 3   | code-agent       | Queue sizing vars (4)                          | `QUEUE_MAX_SIZE`, `QUEUE_TTL_MINUTES`, `RETRY_QUEUE_*` present in Terraform/ecosystem, undocumented in Configuration table |
| 4   | whatsapp-service | `INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION` | In ecosystem only (with default), absent from Terraform and docs Configuration table                                       |
| 5   | research-agent   | `INTEXURAOS_NOTION_SERVICE_URL`                | Set twice in Terraform (common block + explicit research-agent block); redundant                                           |
| 6   | research-agent   | `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`        | In Terraform, absent from REQUIRED_ENV and docs Configuration table                                                        |
| 7   | user-service     | `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI`         | In Terraform secrets, not in REQUIRED_ENV, not referenced in code — likely unused or legacy                                |
| 8   | actions-agent    | `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC`     | In Terraform and ecosystem, absent from REQUIRED_ENV and docs Configuration table                                          |

### Auth vars pattern (confirmed)

The known pattern from previous documentation runs is confirmed: `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, and `INTEXURAOS_AUTH_AUDIENCE` are systematically provided to all services via `common_service_secrets` in Terraform and `COMMON_SERVICE_ENV` in ecosystem. The runtime is not affected.

Documentation coverage:
- **whatsapp-service, research-agent, user-service, commands-agent, actions-agent**: auth vars correctly appear in `REQUIRED_ENV` and in docs Configuration table. Consistent.
- **code-agent**: auth vars are in `PRODUCTION_ONLY_ENV` (not `REQUIRED_ENV`), documented correctly in the Configuration table but described in a code comment as "optional" — technically accurate for E2E mode but potentially misleading for production.
