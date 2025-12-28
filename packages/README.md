# Packages

Shared libraries organized by layer.

## Package Dependency Graph

```
apps/*
  ├── @intexuraos/common-core      (Result types, errors, redaction)
  ├── @intexuraos/common-http      (Fastify plugins, auth, response utilities)
  ├── @intexuraos/http-contracts   (OpenAPI & Fastify JSON schemas)
  ├── @intexuraos/http-server      (Health checks, validation handler)
  ├── @intexuraos/infra-firestore  (Firestore singleton & fake)
  └── @intexuraos/infra-notion     (Notion client & connection repository)
```

## Package Structure

| Package           | Description                                          | Dependencies                     |
| ----------------- | ---------------------------------------------------- | -------------------------------- |
| `common-core`     | Result types, error codes, redaction utilities       | None (leaf)                      |
| `common-http`     | Fastify plugins, JWT auth, API response helpers      | `common-core`                    |
| `http-contracts`  | OpenAPI schemas, Fastify JSON schemas                | None (leaf)                      |
| `http-server`     | Health check utilities, validation error handler     | `common-core`, `infra-firestore` |
| `infra-firestore` | Firestore singleton, fake implementation for testing | None (leaf)                      |
| `infra-notion`    | Notion client, error mapping, connection repository  | `common-core`, `infra-firestore` |

## Testing

All packages have tests in `src/__tests__/` subdirectories using Vitest.

```bash
# Run all package tests
npm run test -- packages

# Run tests for specific package
npm run test -- packages/common-core

# Run tests with coverage
npm run test:coverage
```

### Test Patterns

- **Unit tests**: Pure functions (Result utilities, error mapping, redaction)
- **Integration tests**: Fastify plugin behavior via `app.inject()`
- **Fake implementations**: In-memory Firestore fake for testing adapters

### Coverage Requirements

All packages are subject to the repo-wide coverage thresholds defined in `vitest.config.ts`:

- Lines: 90%
- Branches: 80%
- Functions: 90%
- Statements: 90%

## Import Rules

Enforced by `npm run verify:boundaries`:

- `common-core` → imports nothing
- `common-http` → imports from `common-core`
- `http-contracts` → imports nothing
- `http-server` → imports from `common-core`, `infra-firestore`
- `infra-firestore` → imports nothing
- `infra-notion` → imports from `common-core`, `infra-firestore`
- `apps/*` → imports from any package, but NOT from other apps

See [docs](../docs/README.md) for full architecture details.
