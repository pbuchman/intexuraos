# INT-1537 SUB-D — Catalog choices and migration notes

This document captures the rationale for the pnpm `catalog:` versions chosen
in `pnpm-workspace.yaml` and the conservative knip configuration adopted by
the dead-code gate.

## Selected catalog versions

| Library                   | Catalog version | Rationale                                                                                                                        | What was bumped                                                                                                                     |
| ------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `openai`                  | `^6.15.0`       | Highest range already pinned in `apps/code-agent`, `packages/infra-gpt`, `workers/orchestrator`.                                 | `apps/chat-agent` v4 → v6, `packages/infra-openrouter` v5 → v6.                                                                     |
| `fastify`                 | `^5.6.2`        | Highest pinned in repo (`workers/orchestrator`). All other apps were on `^5.1.0` or `^5.2.0` and resolve compatibly inside `^5`. | All apps/packages aligned to one resolved version (5.6.2).                                                                          |
| `pino`                    | `^10.1.1`       | Highest pinned in repo (e.g. `apps/notion-service`, `apps/llm-usage-service`).                                                   | Workers (`log-cleanup`, `orchestrator`, `transcription`, `vm-lifecycle`) and the root devDependency bumped from `^9.x` → `^10.1.1`. |
| `zod`                     | `^3.24.1`       | Already uniform in repo.                                                                                                         | None.                                                                                                                               |
| `@google-cloud/firestore` | `^7.10.0`       | Already uniform in repo.                                                                                                         | None.                                                                                                                               |

## Migration notes

### `apps/chat-agent` openai v4 → v6
Verified surface used by chat-agent (only file references are
`apps/chat-agent/src/services.ts` and
`apps/chat-agent/src/infra/llm/embeddingClient.ts`):

- `openai.embeddings.create({ model, input })`
- `import type { CreateEmbeddingResponse } from 'openai/resources'`

Both APIs are stable across openai SDK v4 → v6. No code changes required;
typecheck and tests pass after the bump.

### Workers + root pino v9 → v10
Affected packages: `workers/log-cleanup`, `workers/orchestrator`,
`workers/transcription`, `workers/vm-lifecycle`, root devDependency,
`e2e/mock-claude`.

The pino v10 API surface used in this repository (`pino()`, `pino.Logger`,
child loggers via `logger.child(...)`, transports, custom serializers) is
backwards-compatible with v9. No source changes required.

### `packages/infra-openrouter` openai v5 → v6
The package consumes the openai SDK as a peer dependency now. The catalog
range is `^6.15.0`; v5 → v6 introduced a few breaking signature changes,
none of which the openrouter wrapper exercises (it reads
`chat.completions.create(...)` and standard token/usage fields). Verified
via `pnpm run typecheck` and `pnpm run test:coverage`.

## peerDependencies conversion

The following shared-runtime packages had their catalogued runtime libs
moved to `peerDependencies` (with caret-major ranges) and a `devDependencies`
mirror set to `"catalog:"` so their internal tests can run:

- `packages/infra-firestore`: `@google-cloud/firestore ^7.10.0`
- `packages/infra-gpt`: `openai ^6.15.0`
- `packages/infra-openrouter`: `openai ^6.15.0`
- `packages/infra-pubsub`: `pino ^10.1.0`
- `packages/infra-sentry`: `fastify ^5.2.0`, `pino ^10.1.0`
- `packages/common-http`: `fastify ^5.1.0`, `zod ^3.24.1`
- `packages/http-server`: `fastify ^5.1.0`

`packages/llm-utils` and `packages/llm-prompts` are intentionally NOT in the
peerDependencies scope — their `pino`/`zod` remain `dependencies: catalog:`
because they are imported as leaves inside the LLM contract layer rather
than as shared-runtime infrastructure.

## Removed dead workspace dependency

`packages/llm-pricing/package.json` declared `@intexuraos/infra-firestore` as
a dependency, but no source file under `packages/llm-pricing/src/**` imports
from it. The dependency has been removed.

## knip dead-code gate

A knip-based gate is wired in via `pnpm run verify:dead-code`, which is
invoked by `ci:tracked`'s Static Validation phase
(`scripts/ci.mjs` → `{ name: 'dead-code', script: 'verify-dead-code.mjs' }`).

### Configuration scope

This PR is manifest-only by contract. Knip's default reporters surface
hundreds of "unused exports / unused files / unused types" findings that
are predominantly false positives in this codebase (DI containers,
`getServices()` indirection, dynamic imports, namespace re-exports through
barrel `index.ts` files). Cleaning those up requires source-code work that
is explicitly out of scope for SUB-D.

The configuration in `/repo/knip.json` therefore restricts the gate to two
issue categories:

- `dependencies` — declared but unused workspace dependencies
- `unlisted` — imported but undeclared dependencies (the most actionable
  failure mode in a monorepo)

Other categories (`exports`, `nsExports`, `types`, `nsTypes`,
`enumMembers`, `duplicates`, `files`) are excluded for the SUB-D scope.

### `ignoreDependencies` allowlist

The `ignoreDependencies` array in `knip.json` allowlists packages that
knip cannot trace as used due to legitimate reasons:

| Pattern                                                                                                                                                                                                                                                                                            | Rationale                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@intexuraos/.*`                                                                                                                                                                                                                                                                                   | Workspace packages re-export through barrel `index.ts`, plus DI container resolution that knip cannot follow. |
| `@google-cloud/firestore`, `@google-cloud/pubsub`, `@google-cloud/monitoring`                                                                                                                                                                                                                      | Used as type-only imports in tests/migrations and through `infra-firestore` peer.                             |
| `@google/genai`, `openai`, `fastify-server`                                                                                                                                                                                                                                                        | Indirectly consumed via factory wrappers in `infra-*` packages and DI services.                               |
| `axios`, `blessed`, `express`, `firebase-admin`, `firebase-tools`, `vite`, `@vitejs/plugin-react`, `@vitest/coverage-v8`, `nock`, `memfs`                                                                                                                                                          | Tooling / test infra invoked outside knip's entry graph.                                                      |
| `pino`, `pino-pretty`                                                                                                                                                                                                                                                                              | Used through transport spawning and dynamic configuration.                                                    |
| `@auth0/auth0-react`, `@uiw/react-markdown-preview`, `@uiw/react-md-editor`, `highlight.js`, `libphonenumber-js`, `react-markdown`, `rehype-highlight`, `rehype-raw`, `rehype-sanitize`, `remark-gfm`, `vibe-kanban-web-companion`, `lucide-react`, `framer-motion`, `tailwindcss`, `autoprefixer` | `apps/web` UI/runtime/build deps not yet picked up by knip's React + Vite plugin defaults.                    |
| `dotenv`, `minimatch`, `react`, `react-dom`                                                                                                                                                                                                                                                        | Root-level deps consumed by build/runtime/web-app-bundle path.                                                |

The allowlist is intentionally conservative: as the codebase removes the
DI patterns or surfaces unused exports become actionable, future PRs can
narrow the allowlist and/or include additional categories
(`exports`, `types`, `files`).

## Verification

`pnpm run ci:tracked` passes end-to-end on this branch:

- Type & Lint: pass
- Tests: 16578 tests passed
- Static Validation: pass (including new `dead-code` step)
- Build & Format: pass
