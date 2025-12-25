<p align="center">
  <img src="docs/assets/branding/exports/logo-primary-light.png" alt="IntexuraOS Logo" width="280">
</p>

Derived from the Latin _intexere_ (to weave together) and _textura_ (structure), **IntexuraOS** is the integration fabric that interlaces external signals into your central model of truth.
**Notion models the world. IntexuraOS executes.**

![Node.js 22+](https://img.shields.io/badge/Node.js-22+-5FA04E?logo=node.js&logoColor=white)
![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)
![Cloud Run](https://img.shields.io/badge/Google%20Cloud-Run-4285F4?logo=googlecloud&logoColor=white)
![Firestore](https://img.shields.io/badge/Firestore-Native-FFCA28?logo=firebase&logoColor=black)
![Terraform](https://img.shields.io/badge/Terraform-1.5+-844FBA?logo=terraform&logoColor=white)
![Auth0](https://img.shields.io/badge/Auth0-OAuth2-EB5424?logo=auth0&logoColor=white)
![Coverage 89%+](https://img.shields.io/badge/Coverage-90%25+-brightgreen)

---

## Overview

IntexuraOS is the execution layer for a personal operating system where **Notion serves as the single source of truth** for goals, projects, actions, and context. It bridges structured planning in Notion with automated execution via LLM-powered agents and integrations.

**Key use cases:**

- 🤖 ChatGPT custom GPT actions that read/write to your Notion databases
- 📱 WhatsApp → Notion inbox for capturing notes, tasks, and ideas on the go
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
- ✅ **89%+ test coverage** — Enforced by CI with branch/function thresholds
- ✅ **Deterministic builds** — Same inputs produce same outputs; reproducible deployments

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Notion (Source of Truth)                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IntexuraOS (Execution Layer)                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                       Apps Layer                          │   │
│  │  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐  │   │
│  │  │ auth-service │  │promptvault-svc  │  │whatsapp-svc  │  │   │
│  │  │  src/domain/ │  │  src/domain/    │  │  src/domain/ │  │   │
│  │  │  src/infra/  │  │  src/infra/     │  │  src/infra/  │  │   │
│  │  └──────────────┘  └─────────────────┘  └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             │                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      Common Layer                           ││
│  │         @intexuraos/common (Result types, HTTP utils)           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Architecture: App-first Colocation

Each app owns its domain logic and infrastructure adapters:

| App                 | Domain (`src/domain/`)   | Infra (`src/infra/`) |
| ------------------- | ------------------------ | -------------------- |
| auth-service        | identity (tokens, users) | auth0, firestore     |
| promptvault-service | promptvault (prompts)    | notion, firestore    |
| whatsapp-service    | inbox (messages, notes)  | notion, firestore    |
| notion-service      | (orchestration only)     | notion, firestore    |

**Import rules** (enforced by `npm run verify:boundaries`):

- Apps import only from `@intexuraos/common`
- Apps cannot import from other apps
- `@intexuraos/common` imports nothing (leaf package)

For detailed contracts, see [Package Contracts](docs/architecture/package-contracts.md).

---

## Authentication Flow

IntexuraOS supports two OAuth2 flows:

### 1. ChatGPT Actions (Production)

Authorization Code flow for custom GPTs:

1. User activates GPT action → ChatGPT redirects to `/v1/auth/oauth/authorize`
2. IntexuraOS redirects to Auth0 Universal Login
3. User authenticates → Auth0 returns authorization code
4. ChatGPT exchanges code for tokens via `/v1/auth/oauth/token`
5. Access token included in all subsequent API calls

### 2. Device Authorization Flow (Testing/CLI)

For Swagger UI and CLI tools:

```bash
# 1. Start device flow
curl -X POST https://your-service/v1/auth/device/start \
  -H "Content-Type: application/json" \
  -d '{"scope": "openid profile email offline_access"}'

# 2. User visits verification_uri and enters user_code

# 3. Poll for token
curl -X POST https://your-service/v1/auth/device/poll \
  -H "Content-Type: application/json" \
  -d '{"device_code": "XXXX-XXXX"}'
```

**Token Lifetimes:**

| Token         | Lifetime | Notes                                   |
| ------------- | -------- | --------------------------------------- |
| Access token  | 1 hour   | Short-lived; refresh when expired       |
| Refresh token | 15d idle | Stored server-side, encrypted at rest   |
| Refresh token | 30d max  | Absolute maximum regardless of activity |

**Refresh tokens** are encrypted with AES-256-GCM and stored in Firestore. Clients only receive access tokens.

For full setup, see [Auth0 Setup Guide](docs/setup/06-auth0.md).

---

## API Overview

📖 **[Live API Documentation](https://intexuraos-api-docs-hub-ooafxzbaua-lm.a.run.app/docs)** — Unified Swagger UI

### Services

| Service             | Purpose                              | Base Path        |
| ------------------- | ------------------------------------ | ---------------- |
| auth-service        | OAuth2 flows, JWT validation         | `/v1/auth/*`     |
| promptvault-service | Prompt templates, Notion integration | `/v1/*`          |
| whatsapp-service    | WhatsApp webhook receiver            | `/v1/whatsapp/*` |

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
    "items": [...],
    "hasMore": true,
    "nextCursor": "cursor_abc123"
  }
}
```

Pass `cursor` query param to fetch next page.

---

## Error Handling

### Response Format

All errors use a consistent envelope:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Validation failed: email is required",
    "details": { "field": "email" }
  },
  "diagnostics": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "durationMs": 12
  }
}
```

### Error Codes

| Code               | HTTP | Description                       |
| ------------------ | ---- | --------------------------------- |
| `INVALID_REQUEST`  | 400  | Malformed or invalid request      |
| `UNAUTHORIZED`     | 401  | Missing or invalid authentication |
| `FORBIDDEN`        | 403  | Authenticated but not authorized  |
| `NOT_FOUND`        | 404  | Resource does not exist           |
| `CONFLICT`         | 409  | Resource state conflict           |
| `DOWNSTREAM_ERROR` | 502  | External service failure          |
| `INTERNAL_ERROR`   | 500  | Unexpected server error           |
| `MISCONFIGURED`    | 503  | Service misconfiguration          |

### Retry Guidance

- **5xx errors:** Safe to retry with exponential backoff
- **502 DOWNSTREAM_ERROR:** Retry after 1-5 seconds
- **409 CONFLICT:** Check state before retrying
- **4xx errors:** Do not retry; fix request

---

## Data Management

### Storage

| Data                 | Storage               | Retention       |
| -------------------- | --------------------- | --------------- |
| Prompts, Notes       | Notion databases      | User-controlled |
| Refresh tokens       | Firestore (encrypted) | 30 days max     |
| User-Notion mappings | Firestore             | Until revoked   |
| Webhook payloads     | Firestore             | 90 days         |

### Schema

Domain models defined in `packages/domain/*/src/models/`:

- `InboxNote` — Captured items from WhatsApp/email
- `InboxAction` — Derived tasks from inbox notes
- `Prompt` — Template with metadata and version

See [Notion Inbox Schema](docs/notion-inbox.md) for Notion property mappings.

### PII Handling

- Phone numbers stored for WhatsApp user mapping
- All secrets redacted in logs (first 4 + last 4 chars only)
- Tokens encrypted at rest with AES-256-GCM

---

## External Data Sources

### Notion API

- **Integration:** OAuth2 (user-level) or Internal Integration
- **Usage:** Read/write databases for prompts, inbox, actions
- **Rate limits:** 3 requests/second average (Notion-imposed)

### Auth0

- **Integration:** Device Authorization Flow, JWKS validation
- **Usage:** User authentication, token refresh
- **Rate limits:** Varies by plan; free tier has burst limits

### WhatsApp Business Cloud API

- **Integration:** Webhook receiver + REST API
- **Usage:** Receive messages → Notion inbox; send notifications
- **Rate limits:** Tier-based (see Meta docs)

---

## Security

### Endpoint Permissions

| Endpoint Pattern         | Auth Required | Notes                   |
| ------------------------ | ------------- | ----------------------- |
| `/health`                | No            | System endpoint         |
| `/docs`, `/openapi.json` | No            | Documentation           |
| `/v1/auth/device/*`      | No            | Pre-authentication flow |
| `/v1/auth/oauth/*`       | No            | OAuth callbacks         |
| `/v1/*` (other)          | Yes           | Bearer JWT required     |

### Secrets Management

Secrets stored in **GCP Secret Manager** with `INTEXURAOS_*` prefix:

| Secret                            | Purpose                          |
| --------------------------------- | -------------------------------- |
| `INTEXURAOS_AUTH0_DOMAIN`         | Auth0 tenant domain              |
| `INTEXURAOS_AUTH0_CLIENT_ID`      | Native app client ID             |
| `INTEXURAOS_AUTH_JWKS_URL`        | JWKS endpoint for JWT validation |
| `INTEXURAOS_AUTH_ISSUER`          | Expected JWT issuer              |
| `INTEXURAOS_AUTH_AUDIENCE`        | Expected JWT audience            |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY` | AES-256 key for refresh tokens   |
| `INTEXURAOS_WHATSAPP_*`           | WhatsApp API credentials         |

### Vulnerability Reports

Report security issues to the repository owner. Do not open public issues for security vulnerabilities.

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
cd apps/auth-service && npm run dev
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

### Run Tests

```bash
npm run test              # Single run
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

### Coverage Requirements

| Metric     | Threshold |
| ---------- | --------- |
| Lines      | 65%       |
| Branches   | 70%       |
| Functions  | 45%       |
| Statements | 65%       |

(Temporarily lowered; TODO: restore to 89/85/90/89 after adding infra tests)

### Mocking Strategy

- **Firestore:** Emulator for integration tests
- **Auth0:** Fake client in `apps/auth-service/src/__tests__/fakes.ts`
- **Notion:** Fake adapter in `apps/*/src/__tests__/fakes.ts`
- **External HTTP:** No real calls in unit tests

### Testing

Tests use **in-memory fake repositories** via dependency injection. No external services required:

```bash
npm run test          # Run all tests
npm run test:coverage # Run with coverage report
npm run ci            # Full CI pipeline (lint, typecheck, test, build)
```

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
gcloud run revisions list --service=auth-service --region=europe-west4

# Rollback to previous revision
gcloud run services update-traffic auth-service \
  --to-revisions=auth-service-00001-abc=100 \
  --region=europe-west4
```

---

## Observability

### Health Checks

All services expose `GET /health`:

```json
{
  "status": "ok",
  "serviceName": "auth-service",
  "version": "0.0.1",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": [
    { "name": "secrets", "status": "ok", "latencyMs": 15 },
    { "name": "firestore", "status": "ok", "latencyMs": 42 }
  ]
}
```

Status values: `ok` | `degraded` | `down`

### Logging

- **Format:** JSON (structured)
- **Levels:** `debug`, `info`, `warn`, `error`
- **Request ID:** Included in all log entries via `X-Request-Id`
- **Token redaction:** Automatic for sensitive fields

### Metrics

Cloud Run provides built-in metrics:

- Request count, latency, error rate
- Container instance count
- Memory/CPU utilization

---

## Versioning & Changelog

### API Versioning

- **Scheme:** URL path prefix (`/v1/`, `/v2/`)
- **Breaking changes:** New major version
- **Deprecation:** 6-month notice before removal

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
- Use `show_content` for non-trivial output
- Follow import hierarchy (enforced by boundaries)
- 89%+ coverage required

---

## Documentation Map

```
docs/
├── README.md                          # Architecture & philosophy
├── architecture/
│   ├── api-contracts.md               # Response formats, error codes
│   ├── package-contracts.md           # Layer rules, dependencies
│   └── static-assets-hosting.md       # CDN configuration
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
