# Packages

Shared libraries organized by layer.

## Package Dependency Graph

```
apps/*
  ├── @intexuraos/common-core       (Result types, errors, redaction)
  ├── @intexuraos/common-http       (Fastify plugins, auth, response utilities)
  ├── @intexuraos/http-contracts    (OpenAPI & Fastify JSON schemas)
  ├── @intexuraos/http-server       (Health checks, validation handler)
  ├── @intexuraos/infra-claude      (Anthropic Claude API client)
  ├── @intexuraos/infra-firestore   (Firestore singleton & fake)
  ├── @intexuraos/infra-gemini      (Google Gemini API client)
  ├── @intexuraos/infra-glm         (Zai GLM API client)
  ├── @intexuraos/infra-gpt         (OpenAI GPT API client)
  ├── @intexuraos/infra-notion      (Notion client & connection repository)
  ├── @intexuraos/infra-otel        (OpenTelemetry SDK bootstrap)
  ├── @intexuraos/infra-perplexity  (Perplexity AI API client)
  ├── @intexuraos/infra-pubsub      (Cloud Pub/Sub publishers)
  ├── @intexuraos/infra-sentry      (Sentry error tracking & logger factory)
  ├── @intexuraos/infra-whatsapp    (WhatsApp Cloud API client)
  ├── @intexuraos/internal-clients  (HTTP clients for internal services)
  ├── @intexuraos/llm-audit         (LLM API audit logging to Firestore)
  ├── @intexuraos/llm-contract      (Shared LLM types, model names, interfaces)
  ├── @intexuraos/llm-factory       (Unified LLM client factory)
  ├── @intexuraos/llm-pricing       (LLM pricing fetch, cost tracking)
  ├── @intexuraos/llm-prompts       (Centralized LLM prompt builders)
  └── @intexuraos/llm-utils         (Redaction utilities, LLM parse error helpers)
```

## Package Structure

### Common + HTTP

| Package                                                              | Description                                              | Dependencies                          |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| [`common-core`](../docs/packages/common-core/README.md)             | Result types, error codes, redaction utilities           | None (leaf)                           |
| [`common-http`](../docs/packages/common-http/README.md)             | Fastify plugins, JWT auth, API response helpers          | `common-core`, `llm-utils`            |
| [`http-contracts`](../docs/packages/http-contracts/README.md)       | OpenAPI schemas, Fastify JSON schemas                    | None (leaf)                           |
| [`http-server`](../docs/packages/http-server/README.md)             | Health check utilities, validation error handler         | `common-core`, `common-http`, `infra-firestore` |

### Infrastructure

| Package                                                              | Description                                              | Dependencies                          |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| [`infra-claude`](../docs/packages/infra-claude/README.md)           | Anthropic Claude API wrapper implementing `LLMClient`    | `common-core`, `llm-contract`, `llm-audit`, `llm-pricing`, `llm-prompts` |
| [`infra-firestore`](../docs/packages/infra-firestore/README.md)     | Firestore singleton, fake implementation for testing     | None (leaf)                           |
| [`infra-gemini`](../docs/packages/infra-gemini/README.md)           | Google Gemini API wrapper with image generation support  | `common-core`, `llm-contract`, `llm-audit`, `llm-pricing`, `llm-prompts` |
| [`infra-glm`](../docs/packages/infra-glm/README.md)                 | Zai GLM API wrapper (OpenAI-compatible) implementing `LLMClient` | `common-core`, `llm-contract`, `llm-audit`, `llm-pricing`, `llm-prompts` |
| [`infra-gpt`](../docs/packages/infra-gpt/README.md)                 | OpenAI GPT API wrapper with image generation support     | `common-core`, `llm-contract`, `llm-audit`, `llm-pricing`, `llm-prompts` |
| [`infra-notion`](../docs/packages/infra-notion/README.md)           | Notion API client, error mapping, page retrieval         | `common-core`, `infra-firestore`      |
| [`infra-otel`](../docs/packages/infra-otel/README.md)               | OpenTelemetry SDK bootstrap for Dash0 trace/metric export | None (leaf)                          |
| [`infra-perplexity`](../docs/packages/infra-perplexity/README.md)   | Perplexity AI API wrapper with SSE streaming support     | `common-core`, `llm-contract`, `llm-audit`, `llm-pricing`, `llm-prompts` |
| [`infra-pubsub`](../docs/packages/infra-pubsub/README.md)           | Cloud Pub/Sub abstract publisher base and concrete implementations | `common-core`              |
| [`infra-sentry`](../docs/packages/infra-sentry/README.md)           | Sentry SDK init, Pino log stream, Fastify error handler, logger factory | `common-core`    |
| [`infra-whatsapp`](../docs/packages/infra-whatsapp/README.md)       | WhatsApp Business Cloud API client (messages, media, receipts) | None (leaf)               |

### LLM

| Package                                                              | Description                                              | Dependencies                          |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| [`llm-audit`](../docs/packages/llm-audit/README.md)                 | LLM API audit logging to Firestore with full request/response context | `common-core`, `infra-firestore`, `llm-contract` |
| [`llm-contract`](../docs/packages/llm-contract/README.md)           | Shared LLM type definitions, model constants, client interface | `common-core`                    |
| [`llm-factory`](../docs/packages/llm-factory/README.md)             | Unified factory mapping model names to provider-specific clients | `common-core`, `infra-gemini`, `infra-glm`, `llm-audit`, `llm-contract`, `llm-pricing` |
| [`llm-pricing`](../docs/packages/llm-pricing/README.md)             | Fetches LLM pricing from app-settings-service and tracks usage to Firestore | `common-core`, `infra-firestore`, `llm-contract` |
| [`llm-prompts`](../docs/packages/llm-prompts/README.md)             | Centralized library of typed prompt builders with Zod response schemas | `llm-contract`, `common-core`, `llm-utils` |
| [`llm-utils`](../docs/packages/llm-utils/README.md)                 | Sensitive data redaction and structured LLM parse error helpers | `common-core`                  |

### Integration

| Package                                                              | Description                                              | Dependencies                          |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| [`internal-clients`](../docs/packages/internal-clients/README.md)   | Typed HTTP clients for calling IntexuraOS internal service APIs | `common-core`, `llm-contract`, `llm-factory`, `llm-pricing` |

## Testing

All packages have tests in `src/__tests__/` subdirectories using Vitest.

```bash
# Run all package tests
pnpm run test -- packages

# Run tests for specific package
pnpm run test -- packages/common-core

# Run tests with coverage
pnpm run test:coverage
```

### Test Patterns

- **Unit tests**: Pure functions (Result utilities, error mapping, redaction)
- **Integration tests**: Fastify plugin behavior via `app.inject()`
- **Fake implementations**: In-memory Firestore fake for testing adapters

### Coverage Requirements

All packages are subject to the repo-wide coverage thresholds defined in `vitest.config.ts`:

- Lines: 95%
- Branches: 95%
- Functions: 95%
- Statements: 95%

## Import Rules

Enforced by `pnpm run verify:boundaries`:

- `common-core` → imports nothing
- `common-http` → imports from `common-core`, `llm-utils`
- `http-contracts` → imports nothing
- `http-server` → imports from `common-core`, `common-http`, `infra-firestore`
- `infra-firestore` → imports nothing
- `infra-notion` → imports from `common-core`, `infra-firestore`
- `infra-otel` → imports nothing
- `infra-whatsapp` → imports nothing
- `infra-sentry` → imports from `common-core`
- `infra-pubsub` → imports from `common-core`
- `llm-contract` → imports from `common-core`
- `llm-utils` → imports from `common-core`
- `llm-prompts` → imports from `llm-contract`, `common-core`, `llm-utils`
- `llm-audit` → imports from `common-core`, `infra-firestore`, `llm-contract`
- `llm-pricing` → imports from `common-core`, `infra-firestore`, `llm-contract`
- `llm-factory` → imports from `common-core`, `infra-gemini`, `infra-glm`, `llm-audit`, `llm-contract`, `llm-pricing`
- `infra-claude/gemini/gpt/glm/perplexity` → imports from `common-core`, `llm-contract`, `llm-audit`, `llm-pricing`, `llm-prompts`
- `internal-clients` → imports from `common-core`, `llm-contract`, `llm-factory`, `llm-pricing`
- `apps/*` → imports from any package, but NOT from other apps

See [docs](../docs/README.md) for full architecture details.
