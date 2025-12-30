<div style="text-align: center">
  <img src="docs/assets/branding/exports/logo-primary-light.png" alt="IntexuraOS Logo" width="280">
</div>

Derived from the Latin _intexere_ (to weave together) and _textura_ (structure), **IntexuraOS** is the integration fabric that interlaces external signals into your central model of truth.
**Notion models the world. IntexuraOS executes.**

![Node.js 22+](https://img.shields.io/badge/Node.js-22+-22B8CF?logo=node.js&logoColor=white)
![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-22B8CF?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5.x-22B8CF?logo=fastify&logoColor=white)
![Cloud Run](https://img.shields.io/badge/Google%20Cloud-Run-22B8CF?logo=googlecloud&logoColor=white)
![Firestore](https://img.shields.io/badge/Firestore-Native-22B8CF?logo=firebase&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-1.5+-22B8CF?logo=terraform&logoColor=white)
![Auth0](https://img.shields.io/badge/Auth0-OAuth2-22B8CF?logo=auth0&logoColor=white)
![Coverage 95%+](https://img.shields.io/badge/Coverage-95%25+-22B8CF)

---

## Overview

IntexuraOS is the execution layer for a personal operating system where **Notion serves as the single source of truth** for goals, projects, actions, and context. It bridges structured planning in Notion with automated execution via LLM-powered agents and integrations.

**Key use cases:**

- 🎙️ WhatsApp voice notes → automatic transcription with reply
- 🤖 ChatGPT custom GPT actions that read/write to your Notion databases
- 📱 WhatsApp → Notion inbox for capturing notes, tasks, and ideas on the go
- 📲 Mobile notifications → capture Android notifications via Tasker
- 🔐 Secure OAuth2 authentication with Device Authorization Flow for CLI/testing
- 📋 Prompt template management and versioning via PromptVault

---

## Core Features

- ✅ **Hexagonal architecture** — Clean separation of domain logic, infrastructure adapters, and application services
- ✅ **Runtime OpenAPI aggregation** — Unified Swagger UI across all services via api-docs-hub
- ✅ **Notion as source of truth** — All data flows to/from Notion databases
- ✅ **Result-based error handling** — No thrown exceptions; explicit `Result<T, E>` types everywhere
- ✅ **No Dummy Success** — Every operation succeeds with verifiable results or fails explicitly
- ✅ **Idempotent operations** — Safe to retry; no duplicate records or corrupted state
- ✅ **95% test coverage** — Enforced by CI with branch/function thresholds
- ✅ **Deterministic builds** — Same inputs produce same outputs; reproducible deployments

---

## WhatsApp Voice Notes → Transcription

Send a voice message to your WhatsApp bot, receive transcribed text as a reply within seconds.

**Flow:** WhatsApp → whatsapp-service → GCS → Speechmatics → Reply with transcript

Transcription is handled inline by whatsapp-service using fire-and-forget async. This minimizes infrastructure complexity and cold start latency.

📖 See [docs/architecture/transcription.md](docs/architecture/transcription.md) for detailed architecture, configuration, states, and monitoring.

---

## ChatGPT Custom Model

The project includes a ChatGPT custom model (GPT) for prompt review and management:

📂 **[chatgpt-prompts-model/](chatgpt-prompts-model/README.md)** — Notion Prompt Vault

- Review prompts using 10-dimension weighted scoring
- Iterative improvement loop until score ≥ 8.0
- Direct save to Notion via OAuth-authenticated API

---

## Web App (PWA)

IntexuraOS includes a React-based Progressive Web App that can be installed on mobile devices:

📱 **Add to Home Screen** — Works like a native app without app store distribution

- **Android**: Tap the install banner or use browser menu → "Add to Home Screen"
- **iOS**: Open in Safari → Share → "Add to Home Screen"

✨ **Features**:

- Standalone mode (no browser UI)
- Automatic updates on deployment
- Offline asset caching
- iOS safe area support

See [docs/setup/09-pwa.md](docs/setup/09-pwa.md) for full documentation.

---

## LLM-Assisted Development

This project is developed with LLMs as **senior reviewers, architects, and automation components** — not autocomplete tools. Key practices:

- **Explicit constraints** — All LLM interactions include project rules (`.github/copilot-instructions.md`) enforcing architecture boundaries, TypeScript strictness, and test coverage thresholds
- **Verification-first** — LLMs must run `npm run ci` before claiming task completion; no silent assumptions
- **Structured prompts** — Reusable prompt templates in `.github/prompts/` for refactoring, documentation, and multi-step orchestration

### Continuity Ledger Pattern

For complex multi-step tasks, we use a **continuity ledger** — a compaction-safe markdown file (`CONTINUITY.md`) that logs every decision, reasoning step, and state transition.
This enables deterministic resume after interruption, full audit trail of LLM reasoning, and idempotent execution across sessions. See [continuity.md](.claude/commands/continuity.md) for the orchestration protocol or [sample feature](./continuity/archive/014-llm-orchestrator/CONTINUITY.md) developed with this pattern.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Notion (Source of Truth)                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  IntexuraOS (Execution Layer)                   │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                        Apps Layer                         │  │
│  │  ┌─────────────┐  ┌────────────────┐  ┌─────────────────┐ │  │
│  │  │user-service │  │promptvault-svc │  │  whatsapp-svc   │ │  │
│  │  │ src/domain/ │  │  src/domain/   │  │   src/domain/   │ │  │
│  │  │ src/infra/  │  │  src/infra/    │  │   src/infra/    │ │  │
│  │  └─────────────┘  └────────────────┘  └────────┬────────┘ │  │
│  │                                                │          │  │
│  │                                   ┌────────────┴────────┐ │  │
│  │                                   │                     │ │  │
│  │                                   ▼                     ▼ │  │
│  │                           ┌──────────────┐     ┌────────┐ │  │
│  │                           │     GCS      │     │  Spch  │ │  │
│  │                           │ Media Bucket │     │ matics │ │  │
│  │                           └──────────────┘     └────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
│                               │                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                       Common Layer                        │  │
│  │       @intexuraos/common (Result types, HTTP utils)       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Architecture: App-first Colocation

Each app owns its domain logic and infrastructure adapters:

| App                          | Domain (`src/domain/`)   | Infra (`src/infra/`)                 |
| ---------------------------- | ------------------------ | ------------------------------------ |
| user-service                 | identity (tokens, users) | auth0, firestore                     |
| promptvault-service          | promptvault (prompts)    | notion, firestore                    |
| whatsapp-service             | inbox (messages, notes)  | notion, firestore, gcs, speechmatics |
| notion-service               | (orchestration only)     | notion, firestore                    |
| mobile-notifications-service | notifications            | firestore                            |

**Import rules** (enforced by `npm run verify:boundaries`):

- Apps import only from `@intexuraos/common`
- Apps cannot import from other apps
- `@intexuraos/common` imports nothing (leaf package)

For detailed contracts, see [Package Contracts](docs/architecture/package-contracts.md).

---

## Authentication Flow

IntexuraOS supports two OAuth2 flows:

- **Authorization Code** — For ChatGPT custom GPT actions (production)
- **Device Authorization Flow** — For Swagger UI and CLI tools (testing)

Tokens: Access tokens (1h), refresh tokens (30d max, encrypted with AES-256-GCM, stored server-side).

📖 See [Auth0 Setup Guide](docs/setup/06-auth0.md) for full configuration and flow details.

---

## API Overview

📖 **[Live API Documentation](https://intexuraos-api-docs-hub-ooafxzbaua-lm.a.run.app/docs)** — Unified Swagger UI

### Services

| Service                      | Purpose                                 | Base Path                 |
| ---------------------------- | --------------------------------------- | ------------------------- |
| user-service                 | OAuth2 flows, JWT validation            | `/auth/*`                 |
| promptvault-service          | Prompt templates, Notion integration    | `/prompt-vault/*`         |
| whatsapp-service             | WhatsApp webhook, transcription         | `/whatsapp/*`             |
| mobile-notifications-service | Android notification capture via Tasker | `/mobile-notifications/*` |
| notion-service               | Notion integration management           | `/notion/*`               |

### Security

- **Authentication:** Bearer JWT in `Authorization` header
- **JWKS validation:** Tokens verified against Auth0 JWKS endpoint
- **Audience:** `urn:intexuraos:api`
- **Request tracing:** `X-Request-Id` header propagated across services

### Pagination

List endpoints return:

```json
{
  "success": true,
  "data": {
    "items": [],
    "hasMore": true,
    "nextCursor": "cursor_abc123"
  }
}
```

Pass `cursor` query param to fetch next page.

---

## Error Handling

All responses use consistent envelopes with `success`, `error`, and `diagnostics` fields. Error codes include `INVALID_REQUEST` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `DOWNSTREAM_ERROR` (502), etc.

- **5xx errors:** Safe to retry with exponential backoff
- **4xx errors:** Do not retry; fix request

📖 See [docs/architecture/api-contracts.md](docs/architecture/api-contracts.md) for response formats, error codes, and retry guidance.

---

## Data Management

**Storage:** Notion (prompts, notes), Firestore (tokens, mappings, webhooks). All tokens encrypted at rest with AES-256-GCM.

**External APIs:** Notion (3 req/sec), Auth0 (JWKS validation), WhatsApp Business Cloud API (webhooks + REST).

📖 See [Notion Inbox Schema](docs/notion-inbox.md) for database property mappings.

---

## Security

- **Public endpoints:** `/health`, `/docs`, `/openapi.json`, `/auth/device/*`, `/auth/oauth/*`
- **Protected endpoints:** All others require Bearer JWT in `Authorization` header
- **Secrets:** Stored in GCP Secret Manager with `INTEXURAOS_*` prefix

📖 See [docs/operations/secrets.md](docs/operations/secrets.md) for secret inventory and management.

**Vulnerability Reports:** Contact repository owner directly. Do not open public issues.

---

## Setup Guide

### Prerequisites

- Node.js 22+
- GCP project with billing enabled
- Auth0 account (free tier works)
- Terraform 1.5+

### Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/intexuraos.git
cd intexuraos
npm install

# Run tests (uses in-memory fakes, no external deps)
npm run ci

# Start services locally
cd apps/user-service && npm run dev
```

### Environment Variables

Create `.env.local` in repository root:

```bash
# GCP
GOOGLE_CLOUD_PROJECT=your-project-id

# Auth (direct values for local dev)
AUTH_JWKS_URL=https://your-tenant.auth0.com/.well-known/jwks.json
AUTH_ISSUER=https://your-tenant.auth0.com/
AUTH_AUDIENCE=urn:intexuraos:api
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
INTEXURAOS_TOKEN_ENCRYPTION_KEY=your-base64-32-byte-key

# Logging
LOG_LEVEL=debug
```

### Full Setup Guides

1. [GCP Project Setup](docs/setup/01-gcp-project.md)
2. [Terraform Bootstrap](docs/setup/02-terraform-bootstrap.md)
3. [Cloud Build Trigger](docs/setup/03-cloud-build-trigger.md)
4. [Cloud Run Services](docs/setup/04-cloud-run-services.md)
5. [Local Development](docs/setup/05-local-dev-with-gcp-deps.md)
6. [Auth0 Setup](docs/setup/06-auth0.md)
7. [WhatsApp Business Cloud API](docs/setup/07-whatsapp-business-cloud-api.md)

---

## Testing

Tests use **in-memory fake repositories** via dependency injection. No external services required.

```bash
npm run test              # Run all tests
npm run test:coverage     # With coverage report
npm run ci                # Full CI pipeline
```

**Coverage thresholds:** 95% lines/branches/functions/statements (enforced by CI).

📖 See [docs/development/testing.md](docs/development/testing.md) for mocking strategy, test patterns, and setup examples.

---

## Deployment & CI/CD

### Environments

| Environment | Branch        | URL Pattern                 |
| ----------- | ------------- | --------------------------- |
| dev         | `development` | `*-cj44trunra-lm.a.run.app` |
| staging     | `staging`     | (planned)                   |
| prod        | `main`        | (planned)                   |

### CI Pipeline

1. **GitHub Actions:** Lint, typecheck, test, coverage
2. **Cloud Build:** Build Docker images, deploy to Cloud Run
3. **TypeScript project references:** Enable independent app builds

```yaml
# cloudbuild/cloudbuild.yaml
steps:
  - npm ci
  - detect-affected.mjs # Determines which services need rebuild
  - docker build (per service, if affected)
  - docker push
  - gcloud run deploy
```

**Independent builds:** Each app can be built separately via `npm -w apps/<app> run build`.

### Rollback

```bash
# List revisions
gcloud run revisions list --service=user-service --region=europe-west4

# Rollback to previous revision
gcloud run services update-traffic user-service \
  --to-revisions=user-service-00001-abc=100 \
  --region=europe-west4
```

---

## Observability

- **Health checks:** All services expose `GET /health` with status (`ok`/`degraded`/`down`) and dependency checks
- **Logging:** JSON structured, levels `debug`/`info`/`warn`/`error`, request ID via `X-Request-Id`, automatic token redaction
- **Metrics:** Cloud Run built-in (request count, latency, error rate, CPU/memory)

📖 See [docs/architecture/api-contracts.md](docs/architecture/api-contracts.md) for health check response format.

---

## Versioning & Changelog

### API Versioning

- **Scheme:** No URL path versioning; backwards-compatible changes only
- **Breaking changes:** Coordinated deployment with consumer updates
- **Deprecation:** Advance notice before removal

### Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Contributing

### PR Process

1. Fork and create feature branch
2. Ensure `npm run ci` passes
3. Write/update tests (maintain coverage)
4. Submit PR with description of changes
5. Address review feedback
6. Squash merge to target branch

### Code Style

Enforced automatically:

- ESLint with strict TypeScript rules
- Prettier for formatting
- No `@ts-ignore` or `@ts-expect-error`
- Explicit return types on exports

```bash
npm run lint:fix    # Auto-fix lint issues
npm run format      # Format with Prettier
```

---

## Copilot Configuration

AI-assisted development is configured via:

- [`.github/copilot-instructions.md`](.github/copilot-instructions.md) — Global rules
- [`.github/instructions/apps.instructions.md`](.github/instructions/apps.instructions.md) — App-specific rules
- [`.github/instructions/packages.instructions.md`](.github/instructions/packages.instructions.md) — Package rules
- [`.github/instructions/terraform.instructions.md`](.github/instructions/terraform.instructions.md) — IaC rules

Key rules:

- `npm run ci` must pass before task completion
- Follow import hierarchy (enforced by boundaries)
- 95% coverage required

---

## Documentation Map

```
docs/
├── README.md                          # Architecture & philosophy
├── architecture/
│   ├── api-contracts.md               # Response formats, error codes
│   ├── package-contracts.md           # Layer rules, dependencies
│   ├── transcription.md               # WhatsApp voice transcription
│   └── web-app-hosting.md             # GCS + Load Balancer hosting
├── development/
│   └── testing.md                     # Test patterns, mocking, coverage
├── operations/
│   └── secrets.md                     # Secret Manager, env vars
├── setup/
│   ├── 01-gcp-project.md              # GCP project setup
│   ├── 02-terraform-bootstrap.md      # Infrastructure bootstrap
│   ├── 03-cloud-build-trigger.md      # CI/CD setup
│   ├── 04-cloud-run-services.md       # Service deployment
│   ├── 05-local-dev-with-gcp-deps.md  # Local development
│   ├── 06-auth0.md                    # Authentication setup
│   └── 07-whatsapp-business-cloud-api.md  # WhatsApp integration
├── notion-inbox.md                    # Notion database schema
└── assets/branding/                   # Logo and icon assets
```

---

## Glossary

| Term             | Definition                                                  |
| ---------------- | ----------------------------------------------------------- |
| **Domain**       | Business logic layer; no external dependencies              |
| **Infra**        | Infrastructure adapters; SDK wrappers for external services |
| **Port**         | Interface defined in domain; implemented by infra adapters  |
| **Result**       | `Result<T, E>` type for explicit success/failure handling   |
| **DAF**          | Device Authorization Flow (OAuth2 for devices)              |
| **JWKS**         | JSON Web Key Set; used for JWT signature verification       |
| **Inbox Note**   | Captured item from WhatsApp/email pending processing        |
| **Inbox Action** | Task derived from processing an inbox note                  |

---

## License

[MIT License](LICENSE) © 2025 Piotr Buchman
