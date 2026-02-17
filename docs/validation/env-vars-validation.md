# Environment Variables Cross-Validation Report

Generated: 2026-02-08

## Methodology

1. Read `docs/services/{name}/technical.md` for all services with env var documentation
2. Read `apps/{service}/src/index.ts` for `REQUIRED_ENV` arrays (and `workers/orchestrator/src/start.ts`)
3. Read `terraform/environments/dev/main.tf` for what terraform provides
4. Read `ecosystem.config.cjs` for local dev configuration
5. Compared all four sources for each service

## Summary

| Service          | Docs | Code | Terraform | Ecosystem | Issues Found |
| ---------------- | ---- | ---- | --------- | --------- | ------------ |
| chat-agent       | OK   | OK   | OK        | OK        | 0            |
| code-agent       | OK   | OK   | WARN      | OK        | 2            |
| orchestrator     | OK   | OK   | N/A       | N/A       | 1            |
| claude-worker    | OK   | N/A  | N/A       | N/A       | 0            |
| actions-agent    | WARN | OK   | OK        | OK        | 2            |
| research-agent   | WARN | OK   | WARN      | OK        | 3            |
| commands-agent   | OK   | OK   | OK        | OK        | 0            |
| whatsapp-service | WARN | OK   | OK        | OK        | 5            |
| user-service     | WARN | OK   | WARN      | WARN      | 5            |
| linear-agent     | WARN | OK   | OK        | OK        | 1            |

---

## NEW SERVICES -- Detailed Analysis

### chat-agent

**Docs vs Code (REQUIRED_ENV):** MATCH

| Documented Env Var                    | In REQUIRED_ENV | In Terraform         | In Ecosystem |
| ------------------------------------- | --------------- | -------------------- | ------------ |
| `INTEXURAOS_GCP_PROJECT_ID`           | Yes             | Yes (common)         | Yes (common) |
| `INTEXURAOS_AUTH_JWKS_URL`            | Yes             | Yes (common secret)  | Yes (common) |
| `INTEXURAOS_AUTH_ISSUER`              | Yes             | Yes (common secret)  | Yes (common) |
| `INTEXURAOS_AUTH_AUDIENCE`            | Yes             | Yes (common secret)  | Yes (common) |
| `INTEXURAOS_OPENAI_APP_API_KEY`       | Yes             | Yes (service secret) | Yes          |
| `INTEXURAOS_USER_SERVICE_URL`         | Yes             | Yes (common)         | Yes (common) |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | Yes             | Yes (common secret)  | Yes (common) |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | Yes             | Yes (common)         | Yes (common) |
| `INTEXURAOS_ZAI_APP_API_KEY`          | Yes             | Yes (service secret) | Yes          |

**Verdict:** Clean. All three sources aligned.

---

### code-agent

**Docs vs Code (REQUIRED_ENV):** Partial match with documented split into Required/Production-Only.

| Documented Env Var                      | In REQUIRED_ENV | In Terraform         | In Ecosystem |
| --------------------------------------- | --------------- | -------------------- | ------------ |
| `INTEXURAOS_GCP_PROJECT_ID`             | Yes (core)      | Yes (common)         | Yes (common) |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | Yes (core)      | Yes (common secret)  | Yes (common) |
| `INTEXURAOS_WEBHOOK_VERIFY_SECRET`      | Yes (core)      | Yes (service secret) | Yes          |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`       | Yes (core)      | Yes (service secret) | Yes          |
| `INTEXURAOS_ORCHESTRATOR_SECRET`        | Yes (core)      | Yes (service secret) | Yes          |
| `INTEXURAOS_GITHUB_WEBHOOK_SECRET`      | Yes (core)      | Yes (service secret) | Yes          |
| `INTEXURAOS_WHATSAPP_SERVICE_URL`       | Yes (prod-only) | Yes (common)         | Yes (common) |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` | Yes (prod-only) | Yes (service env)    | Yes          |
| `INTEXURAOS_LINEAR_AGENT_URL`           | Yes (prod-only) | Yes (common)         | Yes (common) |
| `INTEXURAOS_ACTIONS_AGENT_URL`          | Yes (prod-only) | Yes (common)         | Yes (common) |
| `INTEXURAOS_SERVICE_URL`                | Yes (prod-only) | Yes (service env)    | Yes          |
| `INTEXURAOS_AUTH_AUDIENCE`              | Yes (prod-only) | Yes (common secret)  | Yes (common) |
| `INTEXURAOS_AUTH_ISSUER`                | Yes (prod-only) | Yes (common secret)  | Yes (common) |
| `INTEXURAOS_AUTH_JWKS_URL`              | Yes (prod-only) | Yes (common secret)  | Yes (common) |

**Issues Found:**

1. **ISSUE: `INTEXURAOS_WEB_URL` used in code but not in REQUIRED_ENV or docs.**
   - File: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts:269`
   - Usage: `process.env['INTEXURAOS_WEB_URL'] ?? 'https://intexuraos.cloud'`
   - Has fallback so won't crash, but is undocumented. Not in terraform or ecosystem either.

2. **ISSUE: Docs list `INTEXURAOS_WHATSAPP_SERVICE_URL` as "Production-Only" but terraform provides it via `common_service_env_vars` to ALL services, not specific to code-agent.** This is not a bug per se, but the doc implies it is only set in production, while terraform always sets it. Minor documentation clarity issue.

---

### orchestrator

**Docs vs Code:** Partial match. The orchestrator uses `getRequiredEnv()` / `getOptionalEnv()` instead of a REQUIRED_ENV array.

| Documented Env Var                  | In Code (getRequiredEnv) | In Terraform | In Ecosystem |
| ----------------------------------- | ------------------------ | ------------ | ------------ |
| `INTEXURAOS_REPOSITORY_URL`         | Yes (required)           | Secret Mgr   | N/A          |
| `INTEXURAOS_CODE_AGENT_URL`         | Yes (required)           | N/A          | N/A          |
| `INTEXURAOS_ORCHESTRATOR_SECRET`    | Yes (required)           | Secret Mgr   | N/A          |
| `INTEXURAOS_PROJECT_ID`             | Yes (required)           | N/A          | N/A          |
| `INTEXURAOS_GITHUB_APP_ID`          | Yes (required)           | Secret Mgr   | N/A          |
| `INTEXURAOS_GITHUB_INSTALLATION_ID` | Yes (required)           | Secret Mgr   | N/A          |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`    | Yes (required)           | N/A          | N/A          |
| `INTEXURAOS_LINEAR_API_KEY`         | Yes (required)           | Secret Mgr   | N/A          |
| `INTEXURAOS_SENTRY_AUTH_TOKEN`      | Yes (required)           | Secret Mgr   | N/A          |
| `GOOGLE_APPLICATION_CREDENTIALS`    | Yes (required)           | N/A          | N/A          |
| `INTEXURAOS_REPOSITORY_PATH`        | Yes (optional)           | N/A          | N/A          |
| `INTEXURAOS_ANTHROPIC_API_KEY`      | Yes (optional)           | Secret Mgr   | N/A          |
| `INTEXURAOS_ZAI_APP_API_KEY`        | Yes (optional)           | Secret Mgr   | N/A          |
| `INTEXURAOS_WORKER_CAPACITY`        | Yes (optional)           | N/A          | N/A          |
| `PORT`                              | Yes (optional)           | N/A          | N/A          |
| `LOG_LEVEL`                         | Yes (optional)           | N/A          | N/A          |

**Note:** Orchestrator runs on a local machine (not Cloud Run), so terraform and ecosystem.config.cjs are not applicable. Secrets are fetched from Secret Manager at runtime.

**Issues Found:**

1. **ISSUE: Naming convention violation -- `INTEXURAOS_PROJECT_ID` vs `INTEXURAOS_GCP_PROJECT_ID`.**
   - The orchestrator uses `INTEXURAOS_PROJECT_ID` while all other services use `INTEXURAOS_GCP_PROJECT_ID`.
   - Documentation correctly documents `INTEXURAOS_PROJECT_ID` matching the code, but this is an inconsistency across the platform.

---

### claude-worker

Claude-worker is a Docker container, not a Node.js service. It does not have `REQUIRED_ENV` validation. Environment variables are injected by the orchestrator's `DockerProvider`. Documentation accurately reflects the container environment variables. No issues found.

---

## SPOT-CHECK SERVICES -- Detailed Analysis

### actions-agent

**Docs vs Code (REQUIRED_ENV):**

| Documented Env Var                         | In REQUIRED_ENV | Notes |
| ------------------------------------------ | --------------- | ----- |
| `INTEXURAOS_RESEARCH_AGENT_URL`            | Yes             | Match |
| `INTEXURAOS_USER_SERVICE_URL`              | Yes             | Match |
| `INTEXURAOS_COMMANDS_AGENT_URL`            | Yes             | Match |
| `INTEXURAOS_TODOS_AGENT_URL`               | Yes             | Match |
| `INTEXURAOS_NOTES_AGENT_URL`               | Yes             | Match |
| `INTEXURAOS_BOOKMARKS_AGENT_URL`           | Yes             | Match |
| `INTEXURAOS_CALENDAR_AGENT_URL`            | Yes             | Match |
| `INTEXURAOS_LINEAR_AGENT_URL`              | Yes             | Match |
| `INTEXURAOS_CODE_AGENT_URL`                | Yes             | Match |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`      | Yes             | Match |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`           | Yes             | Match |
| `INTEXURAOS_GCP_PROJECT_ID`                | Yes             | Match |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | Yes             | Match |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | Yes             | Match |
| `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | Yes             | Match |
| `INTEXURAOS_WEB_APP_URL`                   | Yes             | Match |

**Issues Found:**

1. **ISSUE: Docs missing `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`.**
   - These are in the code REQUIRED_ENV array (lines 8-10 of index.ts) but NOT listed in the docs Configuration table.
   - Terraform provides them via `common_service_secrets`.

2. **ISSUE: Docs do not mention `INTEXURAOS_SENTRY_DSN` (optional, used in code line 30).**
   - Minor since it is optional and provided via terraform common secrets.

---

### research-agent

**Docs vs Code (REQUIRED_ENV):**

| Documented Env Var                         | In REQUIRED_ENV | Notes |
| ------------------------------------------ | --------------- | ----- |
| `INTEXURAOS_USER_SERVICE_URL`              | Yes             | Match |
| `INTEXURAOS_IMAGE_SERVICE_URL`             | Yes             | Match |
| `INTEXURAOS_NOTION_SERVICE_URL`            | Yes             | Match |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`           | Yes             | Match |
| `INTEXURAOS_GCP_PROJECT_ID`                | Yes             | Match |
| `INTEXURAOS_PUBSUB_LLM_CALL_TOPIC`         | Yes             | Match |
| `INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC` | Yes             | Match |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | Yes             | Match |
| `INTEXURAOS_WEB_APP_URL`                   | Yes             | Match |
| `INTEXURAOS_SHARED_CONTENT_BUCKET`         | Yes             | Match |
| `INTEXURAOS_SHARE_BASE_URL`                | Yes             | Match |
| `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`         | Yes             | Match |

**Issues Found:**

1. **ISSUE: Docs missing `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`.**
   - These are in REQUIRED_ENV (lines 15-17) but not in the docs Configuration table.

2. **ISSUE: Docs missing `INTEXURAOS_APP_SETTINGS_SERVICE_URL`.**
   - Present in REQUIRED_ENV (line 21) but not documented.

3. **ISSUE: Terraform provides `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` (line 1034) but this is NOT in REQUIRED_ENV or docs.**
   - Likely unused or used elsewhere in the codebase. May be dead terraform config.

---

### whatsapp-service

**Docs vs Code (REQUIRED_ENV):**

The docs use **different env var names** than the code. This is a significant documentation problem.

| Docs Name                                     | Code Name (REQUIRED_ENV)                  | Match?                           |
| --------------------------------------------- | ----------------------------------------- | -------------------------------- |
| `INTEXURAOS_APP_SECRET`                       | `INTEXURAOS_WHATSAPP_APP_SECRET`          | MISMATCH -- docs uses short name |
| `INTEXURAOS_VERIFY_TOKEN`                     | `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`        | MISMATCH -- docs uses short name |
| `INTEXURAOS_ALLOWED_WABA_IDS`                 | `INTEXURAOS_WHATSAPP_WABA_ID`             | MISMATCH -- different name       |
| `INTEXURAOS_ALLOWED_PHONE_NUMBER_IDS`         | `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID`     | MISMATCH -- different name       |
| `INTEXURAOS_GCS_BUCKET_NAME`                  | `INTEXURAOS_WHATSAPP_MEDIA_BUCKET`        | MISMATCH -- different name       |
| `INTEXURAOS_PUBSUB_WHATSAPP_WEBHOOK_PROCESS`  | `INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC` | MISMATCH -- different name       |
| `INTEXURAOS_PUBSUB_WHATSAPP_AUDIO_TRANSCRIBE` | `INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC`   | MISMATCH -- different name       |
| `INTEXURAOS_PUBSUB_COMMAND_INGEST`            | `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC` | MISMATCH -- different name       |
| `INTEXURAOS_PUBSUB_WHATSAPP_LINKPREVIEW`      | (not in REQUIRED_ENV)                     | REMOVED from code                |
| `INTEXURAOS_PUBSUB_WHATSAPP_MEDIA_CLEANUP`    | `INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC`   | MISMATCH -- different name       |
| `INTEXURAOS_PUBSUB_ACTION_APPROVAL_REPLY`     | `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`  | MISMATCH -- different name       |

**Issues Found:**

1. **CRITICAL: Docs env var names are completely outdated.** The documentation appears to reference old env var names that were since renamed. Every Pub/Sub topic and WhatsApp credential env var has a different name in code vs docs.

2. **ISSUE: Docs missing `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE`** -- present in REQUIRED_ENV.

3. **ISSUE: Docs missing `INTEXURAOS_SPEECHMATICS_APP_API_KEY`** -- present in REQUIRED_ENV.

4. **ISSUE: Docs missing `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`** -- present in REQUIRED_ENV.

5. **ISSUE: Docs missing `INTEXURAOS_WEB_AGENT_URL`** -- present in REQUIRED_ENV but not documented. Also not in docs and not in ecosystem (whatsapp-service section), though it IS in the common service URLs.

---

### user-service

**Docs vs Code (REQUIRED_ENV):**

| Documented Env Var                      | In REQUIRED_ENV | Notes                                    |
| --------------------------------------- | --------------- | ---------------------------------------- |
| `INTEXURAOS_AUTH0_DOMAIN`               | Yes             | Match                                    |
| `INTEXURAOS_AUTH0_CLIENT_ID`            | Yes             | Match                                    |
| `INTEXURAOS_AUTH0_CLIENT_SECRET`        | NO              | Docs say required, code does NOT require |
| `INTEXURAOS_AUTH0_AUDIENCE`             | NO              | Docs say required, code does NOT require |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`        | Yes             | Match                                    |
| `INTEXURAOS_ENCRYPTION_KEY`             | Yes             | Match                                    |
| `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`     | Yes             | Match                                    |
| `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET` | Yes             | Match                                    |
| `INTEXURAOS_FIREBASE_PROJECT_ID`        | NO              | Docs say required, code does NOT require |
| `INTEXURAOS_FIREBASE_CLIENT_EMAIL`      | NO              | Docs say required, code does NOT require |
| `INTEXURAOS_FIREBASE_PRIVATE_KEY`       | NO              | Docs say required, code does NOT require |
| `INTEXURAOS_WEB_APP_URL`                | Yes             | Match                                    |

**Missing from docs but in REQUIRED_ENV:**

| Code REQUIRED_ENV Var                 | In Docs | Notes          |
| ------------------------------------- | ------- | -------------- |
| `INTEXURAOS_GCP_PROJECT_ID`           | NO      | Not documented |
| `INTEXURAOS_AUTH_JWKS_URL`            | NO      | Not documented |
| `INTEXURAOS_AUTH_ISSUER`              | NO      | Not documented |
| `INTEXURAOS_AUTH_AUDIENCE`            | NO      | Not documented |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`     | NO      | Not documented |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | NO      | Not documented |

**Issues Found:**

1. **ISSUE: Docs list 4 env vars that are NOT in REQUIRED_ENV** (`AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`). Either docs are outdated or these are used elsewhere.

2. **ISSUE: Docs missing 6 env vars that ARE in REQUIRED_ENV** (`GCP_PROJECT_ID`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `TOKEN_ENCRYPTION_KEY`, `APP_SETTINGS_SERVICE_URL`).

3. **ISSUE: Terraform provides `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` as a secret but it is not in REQUIRED_ENV.** Could be used via `process.env` directly without validation.

4. **ISSUE: Ecosystem missing `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI`** -- terraform provides it as a secret, ecosystem does not.

5. **ISSUE: Docs reference `INTEXURAOS_AUTH0_CLIENT_SECRET`** which is not in terraform secrets (only `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` are in terraform secrets for user-service). This may be a removed/deprecated var.

---

### linear-agent

**Docs vs Code (REQUIRED_ENV):**

| Documented Env Var                    | In REQUIRED_ENV | Notes                           |
| ------------------------------------- | --------------- | ------------------------------- |
| `INTEXURAOS_USER_SERVICE_URL`         | Yes             | Match                           |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | Yes             | Match                           |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | Yes             | Match                           |
| `INTEXURAOS_AUTH_JWKS_URL`            | Yes             | Match                           |
| `INTEXURAOS_AUTH_ISSUER`              | Yes             | Match                           |
| `INTEXURAOS_AUTH_AUDIENCE`            | Yes             | Match                           |
| `INTEXURAOS_SENTRY_DSN`               | Yes (hardcoded) | Match -- code throws if missing |

**Issues Found:**

1. **ISSUE: Docs missing `INTEXURAOS_GCP_PROJECT_ID`** -- present in REQUIRED_ENV (line 13) but not listed in docs.

---

### commands-agent

**Docs vs Code (REQUIRED_ENV):** MATCH (with caveat that auth vars are in REQUIRED_ENV but not in docs).

All documented vars match. However, like other services, `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_AUDIENCE` are in REQUIRED_ENV but not in the docs table. The docs table only has 5 entries while REQUIRED_ENV has 9. Since this pattern is common across multiple services, I am noting it as a systemic issue below rather than per-service.

---

## Systemic Issues

### 1. Auth Vars Consistently Missing from Docs

The following env vars are in REQUIRED_ENV for nearly every service but frequently omitted from documentation:

- `INTEXURAOS_AUTH_JWKS_URL`
- `INTEXURAOS_AUTH_ISSUER`
- `INTEXURAOS_AUTH_AUDIENCE`
- `INTEXURAOS_GCP_PROJECT_ID`

**Affected services:** actions-agent, research-agent, whatsapp-service, user-service, linear-agent, commands-agent

**Root cause:** Docs appear to document only "interesting" or service-specific env vars and omit the common/shared ones.

### 2. `INTEXURAOS_SENTRY_DSN` Inconsistently Documented

Some docs list it as required, others omit it entirely. In code, it is consistently optional (checked but not in REQUIRED_ENV) for most services, except `linear-agent` which throws if missing.

### 3. whatsapp-service Docs Severely Outdated

The env var names in whatsapp-service docs do not match the actual code at all. This is the worst documentation gap found in this audit.

### 4. Naming Convention Violation

`INTEXURAOS_PROJECT_ID` (orchestrator) vs `INTEXURAOS_GCP_PROJECT_ID` (all other services). The orchestrator should use `INTEXURAOS_GCP_PROJECT_ID` for consistency, or at minimum the discrepancy should be documented.

---

## Terraform Coverage Summary

### Common Service Env Vars (provided to ALL services)

| Env Var                                       | Type |
| --------------------------------------------- | ---- |
| `INTEXURAOS_ENVIRONMENT`                      | env  |
| `INTEXURAOS_GCP_PROJECT_ID`                   | env  |
| `INTEXURAOS_USER_SERVICE_URL`                 | env  |
| `INTEXURAOS_NOTION_SERVICE_URL`               | env  |
| `INTEXURAOS_WHATSAPP_SERVICE_URL`             | env  |
| `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL` | env  |
| `INTEXURAOS_RESEARCH_AGENT_URL`               | env  |
| `INTEXURAOS_COMMANDS_AGENT_URL`               | env  |
| `INTEXURAOS_ACTIONS_AGENT_URL`                | env  |
| `INTEXURAOS_DATA_INSIGHTS_AGENT_URL`          | env  |
| `INTEXURAOS_IMAGE_SERVICE_URL`                | env  |
| `INTEXURAOS_NOTES_AGENT_URL`                  | env  |
| `INTEXURAOS_TODOS_AGENT_URL`                  | env  |
| `INTEXURAOS_BOOKMARKS_AGENT_URL`              | env  |
| `INTEXURAOS_CODE_AGENT_URL`                   | env  |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`         | env  |
| `INTEXURAOS_CALENDAR_AGENT_URL`               | env  |
| `INTEXURAOS_WEB_AGENT_URL`                    | env  |
| `INTEXURAOS_LINEAR_AGENT_URL`                 | env  |
| `INTEXURAOS_CHAT_AGENT_URL`                   | env  |
| `INTEXURAOS_API_DOCS_HUB_URL`                 | env  |

### Common Service Secrets (provided to ALL services)

| Secret                           |
| -------------------------------- |
| `INTEXURAOS_AUTH_JWKS_URL`       |
| `INTEXURAOS_AUTH_ISSUER`         |
| `INTEXURAOS_AUTH_AUDIENCE`       |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` |
| `INTEXURAOS_SENTRY_DSN`          |

---

## Recommendations

1. **HIGH: Fix whatsapp-service docs** -- env var names are completely wrong. Every env var name needs updating to match actual code.

2. **HIGH: Fix user-service docs** -- both false positives (vars listed as required but not in code) and false negatives (vars in code but not documented).

3. **MEDIUM: Standardize documentation pattern** -- either all docs should include common vars (auth, GCP project ID, Sentry DSN) or explicitly state "Plus standard common env vars" with a link to a shared reference.

4. **MEDIUM: Rename `INTEXURAOS_PROJECT_ID` to `INTEXURAOS_GCP_PROJECT_ID` in orchestrator** for consistency across all services.

5. **LOW: Document `INTEXURAOS_WEB_URL` in code-agent** or remove its usage and use `INTEXURAOS_WEB_APP_URL` instead (which is the standard name used by actions-agent and other services).

6. **LOW: Investigate `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`** in terraform for research-agent -- it is provided by terraform but not required by code. May be dead config.
