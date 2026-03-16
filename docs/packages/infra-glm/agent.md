# Agent Reference: @intexuraos/infra-glm

> **RETIRED** — This package was deleted in v3.3.0. Do not reference or import this package.

## Status

| Attribute     | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| Package       | `@intexuraos/infra-glm`                                       |
| Status        | Deleted in v3.3.0 (commit `93aeac4a3`, 2026-03-12)            |
| Reason        | ZAI provider removed; GLM-5 moved to DashScope code-task path |
| Superseded by | DashScope-backed code-task subsystem (no shared package)      |

## Migration

If you encounter code referencing `@intexuraos/infra-glm`:

1. Remove the import entirely.
2. GLM-5 is available via the code-task subsystem using the `'glm'` backward-compatible alias.
3. There is no replacement `LLMClient` package for GLM models.

## Constraints

**Do NOT:**

- Import from `@intexuraos/infra-glm` — the package source has been deleted
- Reference `LlmProviders.Zai` — removed from `@intexuraos/llm-contract` in v3.3.0
- Reference `LlmModels.GLM47` or `LlmModels.GLM47Flash` — removed in v3.3.0
