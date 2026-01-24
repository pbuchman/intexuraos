# llm-common Restructuring Plan

> **SUPERSEDED** by [2026-01-24-llm-prompts-extraction.md](./2026-01-24-llm-prompts-extraction.md)
>
> The `llm-common` package has been replaced by `llm-prompts` and `llm-utils`.
> See [LLM Packages Reference](../architecture/llm-packages.md) for current architecture.

---

**Linear Issue:** [INT-69](https://linear.app/pbuchman/issue/INT-69/refactor-restructure-llm-common-with-per-package-directories)
**Sub-task:** [INT-70](https://linear.app/pbuchman/issue/INT-70/pbu-69-plan-llm-common-restructuring-approach)
**Date:** 2026-01-16

---

## 1. Current State Analysis

### 1.1 Directory Structure

```
packages/llm-common/src/
├── __tests__/                    # Root-level tests (legacy)
│   └── context/
├── classification/               # ✓ Domain-organized
│   └── __tests__/
├── context/                      # ✓ Domain-organized
├── dataInsights/                 # ✓ Domain-organized
│   └── __tests__/
├── generation/                   # ✓ Domain-organized
│   └── __tests__/
├── image/                        # ✓ Domain-organized
│   └── __tests__/
├── llm/                          # ✓ Domain-organized
│   └── __tests__/
├── todos/                        # ✓ Domain-organized
│   └── __tests__/
├── validation/                   # ✓ Domain-organized
│   └── __tests__/
├── attribution.ts                # ✗ Flat (should be in domain)
├── redaction.ts                  # ✗ Flat (should be in shared/)
├── researchPrompt.ts             # ✗ Flat (should be in research/)
├── synthesisPrompt.ts            # ✗ Flat (should be in synthesis/)
├── types.ts                      # ✗ Flat (should be in shared/)
└── index.ts                      # Barrel export
```

### 1.2 Current Exports by Category

| Module               | Exports                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `types.ts`           | `PromptBuilder`, `PromptDeps`                                                                    |
| `generation/`        | `titlePrompt`, `labelPrompt`, `feedNamePrompt` + types                                           |
| `classification/`    | `commandClassifierPrompt`, `calendarActionExtractionPrompt`, `linearActionExtractionPrompt`      |
| `todos/`             | `itemExtractionPrompt` + types                                                                   |
| `image/`             | `thumbnailPrompt` + types                                                                        |
| `validation/`        | `inputQualityPrompt`, `inputImprovementPrompt`, guards, repair prompts                           |
| `context/`           | `buildInferResearchContextPrompt`, `buildInferSynthesisContextPrompt`, guards, repair, types     |
| `researchPrompt.ts`  | `buildResearchPrompt`                                                                            |
| `synthesisPrompt.ts` | `buildSynthesisPrompt`, `SynthesisReport`, `AdditionalSource`                                    |
| `attribution.ts`     | `parseAttributionLine`, `parseSections`, `buildSourceMap`, `validateSynthesisAttributions`, etc. |
| `redaction.ts`       | `redactToken`, `redactObject`, `SENSITIVE_FIELDS`                                                |
| `llm/`               | `createLlmParseError`, `logLlmParseError`, `withLlmParseErrorLogging`                            |
| `dataInsights/`      | `dataAnalysisPrompt`, `chartDefinitionPrompt`, `dataTransformPrompt`, parsers, repair            |

### 1.3 Consumer Mapping

| Consumer App/Package    | Imports                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **research-agent**      | `buildSynthesisPrompt`, `titlePrompt`, `SynthesisContext`, `ResearchContext`, context inference, attribution, validation |
| **data-insights-agent** | `dataAnalysisPrompt`, `chartDefinitionPrompt`, `dataTransformPrompt`, `titlePrompt`, `feedNamePrompt`, parsers           |
| **commands-agent**      | `commandClassifierPrompt`                                                                                                |
| **calendar-agent**      | `calendarActionExtractionPrompt`                                                                                         |
| **linear-agent**        | `linearActionExtractionPrompt`                                                                                           |
| **todos-agent**         | `itemExtractionPrompt`                                                                                                   |
| **infra-gemini**        | `buildResearchPrompt`                                                                                                    |
| **infra-gpt**           | `buildResearchPrompt`                                                                                                    |
| **infra-claude**        | `buildResearchPrompt`                                                                                                    |
| **infra-glm**           | `buildResearchPrompt`                                                                                                    |
| **infra-perplexity**    | `buildResearchPrompt`                                                                                                    |
| **common-http**         | `redactToken`, `redactObject`, `SENSITIVE_FIELDS`                                                                        |
| **llm-contract**        | `thumbnailPrompt`                                                                                                        |

---

## 2. Proposed Structure

### 2.1 New Directory Layout

```
packages/llm-common/src/
├── research/                     # Research domain
│   ├── __tests__/
│   ├── buildResearchPrompt.ts    # Moved from root
│   ├── buildSynthesisPrompt.ts   # Moved from synthesisPrompt.ts
│   ├── attribution.ts            # Moved from root
│   ├── contextInference.ts       # Merged from context/inferResearchContext.ts
│   ├── types.ts                  # Research-specific types
│   └── index.ts
│
├── synthesis/                    # Synthesis domain (subset of research)
│   ├── __tests__/
│   ├── contextInference.ts       # From context/inferSynthesisContext.ts
│   ├── types.ts
│   └── index.ts
│
├── classification/               # Classification domain (unchanged)
│   ├── __tests__/
│   ├── commandClassifierPrompt.ts
│   ├── calendarActionExtractionPrompt.ts
│   ├── linearActionExtractionPrompt.ts
│   └── index.ts
│
├── generation/                   # Content generation (unchanged)
│   ├── __tests__/
│   ├── titlePrompt.ts
│   ├── labelPrompt.ts
│   ├── feedNamePrompt.ts
│   └── index.ts
│
├── dataInsights/                 # Data insights domain (unchanged)
│   ├── __tests__/
│   └── index.ts
│
├── validation/                   # Input validation (unchanged)
│   ├── __tests__/
│   └── index.ts
│
├── todos/                        # Todos domain (unchanged)
│   ├── __tests__/
│   └── index.ts
│
├── image/                        # Image processing (unchanged)
│   ├── __tests__/
│   └── index.ts
│
├── shared/                       # Cross-cutting utilities (NEW)
│   ├── __tests__/
│   ├── redaction.ts              # Moved from root
│   ├── parseError.ts             # Moved from llm/
│   ├── types.ts                  # PromptBuilder, PromptDeps
│   └── index.ts
│
└── index.ts                      # Barrel export (backward compatible)
```

### 2.2 Key Decisions

| Decision                                    | Rationale                                                       |
| ------------------------------------------- | --------------------------------------------------------------- |
| Create `research/` domain                   | Groups research-specific prompts and attribution together       |
| Create `synthesis/` as separate domain      | Synthesis has its own context inference, distinct from research |
| Create `shared/` for cross-cutting concerns | `redaction.ts` is used by `common-http`, not research-specific  |
| Keep `classification/` unchanged            | Already well-organized by consumer domain                       |
| Keep `generation/` unchanged                | Already well-organized; used by multiple consumers              |
| Move `llm/parseError.ts` to `shared/`       | Generic LLM error handling, not domain-specific                 |
| Maintain backward-compatible exports        | No breaking changes to consumers                                |

### 2.3 Migration Path

**Phase 1: Create new structure (non-breaking)**

1. Create `research/`, `synthesis/`, `shared/` directories
2. Move files to new locations
3. Update internal imports within llm-common
4. Update barrel exports in `index.ts` to re-export from new locations
5. Verify all consumers still work (no import changes required)

**Phase 2: Update consumers (optional, future)**

1. Update consumer imports to use domain-specific paths (e.g., `@intexuraos/llm-common/research`)
2. Add package.json exports for subpath imports
3. Deprecate flat imports in favor of domain imports

---

## 3. File Movement Plan

### 3.1 Files to Move

| Current Location                   | New Location                                        |
| ---------------------------------- | --------------------------------------------------- |
| `researchPrompt.ts`                | `research/buildResearchPrompt.ts`                   |
| `synthesisPrompt.ts`               | `research/buildSynthesisPrompt.ts`                  |
| `attribution.ts`                   | `research/attribution.ts`                           |
| `context/inferResearchContext.ts`  | `research/contextInference.ts`                      |
| `context/inferSynthesisContext.ts` | `synthesis/contextInference.ts`                     |
| `context/guards.ts`                | Split: `research/guards.ts` + `synthesis/guards.ts` |
| `context/types.ts`                 | Split: `research/types.ts` + `synthesis/types.ts`   |
| `context/buildRepairPrompt.ts`     | Split by domain                                     |
| `redaction.ts`                     | `shared/redaction.ts`                               |
| `types.ts`                         | `shared/types.ts`                                   |
| `llm/parseError.ts`                | `shared/parseError.ts`                              |

### 3.2 Files to Keep in Place

| File/Directory    | Reason                   |
| ----------------- | ------------------------ |
| `classification/` | Already domain-organized |
| `generation/`     | Already domain-organized |
| `dataInsights/`   | Already domain-organized |
| `validation/`     | Already domain-organized |
| `todos/`          | Already domain-organized |
| `image/`          | Already domain-organized |

### 3.3 Directories to Remove

| Directory  | Reason                                               |
| ---------- | ---------------------------------------------------- |
| `context/` | Contents distributed to `research/` and `synthesis/` |
| `llm/`     | Contents moved to `shared/`                          |

---

## 4. Barrel Export Strategy

### 4.1 Main `index.ts` (Backward Compatible)

```typescript
// Re-export everything for backward compatibility
export * from './research/index.js';
export * from './synthesis/index.js';
export * from './classification/index.js';
export * from './generation/index.js';
export * from './dataInsights/index.js';
export * from './validation/index.js';
export * from './todos/index.js';
export * from './image/index.js';
export * from './shared/index.js';
```

### 4.2 Domain-Specific Exports (New)

Each domain will have its own `index.ts` that exports only domain-relevant items:

- `research/index.ts` — Research prompts, context inference, attribution
- `synthesis/index.ts` — Synthesis prompts, context inference
- `shared/index.ts` — Redaction, parse errors, base types

---

## 5. Risk Assessment

| Risk                   | Likelihood | Impact | Mitigation                                    |
| ---------------------- | ---------- | ------ | --------------------------------------------- |
| Import path breakage   | Low        | High   | Maintain all existing exports in root index   |
| Circular dependencies  | Medium     | Medium | Careful ordering of imports; lint enforcement |
| Test path breakage     | Medium     | Low    | Update test imports alongside source files    |
| Type resolution issues | Low        | Medium | Verify TypeScript paths after restructure     |

---

## 6. Verification Checklist

After restructuring, verify:

- [ ] `pnpm run typecheck` passes in llm-common
- [ ] `pnpm run test` passes in llm-common
- [ ] All consuming apps build successfully
- [ ] All consuming apps pass tests
- [ ] `pnpm run ci:tracked` passes at monorepo level
- [ ] No new ESLint warnings about imports

---

## 7. Implementation Timeline

**INT-71 (Implementation) should execute:**

1. Create new directory structure
2. Move files according to plan
3. Update internal imports
4. Update barrel exports
5. Run full CI verification
6. Create PR

**Estimated scope:** Medium (primarily file moves and import updates, no logic changes)

---

## 8. Consumer Import Updates (Phase 2)

Phase 1 maintains backward compatibility — consumers don't need to change. Phase 2 (optional) updates consumers to use domain-specific imports for better clarity and tree-shaking.

### 8.1 research-agent

| Current Import                                                                    | New Import                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `import { buildSynthesisPrompt, SynthesisContext } from '@intexuraos/llm-common'` | `import { buildSynthesisPrompt, SynthesisContext } from '@intexuraos/llm-common/research'` |
| `import { ResearchContext } from '@intexuraos/llm-common'`                        | `import { ResearchContext } from '@intexuraos/llm-common/research'`                        |
| `import { titlePrompt } from '@intexuraos/llm-common'`                            | `import { titlePrompt } from '@intexuraos/llm-common/generation'`                          |
| `import { stripAttributionLines } from '@intexuraos/llm-common'`                  | `import { stripAttributionLines } from '@intexuraos/llm-common/research'`                  |
| `import { buildInferResearchContextPrompt, ... } from '@intexuraos/llm-common'`   | `import { buildInferResearchContextPrompt, ... } from '@intexuraos/llm-common/research'`   |
| `import { inputQualityPrompt, ... } from '@intexuraos/llm-common'`                | `import { inputQualityPrompt, ... } from '@intexuraos/llm-common/validation'`              |

**Files to update:** 9 files in `apps/research-agent/src/`

### 8.2 data-insights-agent

| Current Import                                                     | New Import                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `import { dataAnalysisPrompt, ... } from '@intexuraos/llm-common'` | `import { dataAnalysisPrompt, ... } from '@intexuraos/llm-common/dataInsights'` |
| `import { titlePrompt } from '@intexuraos/llm-common'`             | `import { titlePrompt } from '@intexuraos/llm-common/generation'`               |
| `import { feedNamePrompt } from '@intexuraos/llm-common'`          | `import { feedNamePrompt } from '@intexuraos/llm-common/generation'`            |

**Files to update:** 6 files in `apps/data-insights-agent/src/`

### 8.3 commands-agent

| Current Import                                                     | New Import                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `import { commandClassifierPrompt } from '@intexuraos/llm-common'` | `import { commandClassifierPrompt } from '@intexuraos/llm-common/classification'` |

**Files to update:** 1 file (`apps/commands-agent/src/infra/gemini/classifier.ts`)

### 8.4 calendar-agent

| Current Import                                                            | New Import                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `import { calendarActionExtractionPrompt } from '@intexuraos/llm-common'` | `import { calendarActionExtractionPrompt } from '@intexuraos/llm-common/classification'` |

**Files to update:** 1 file (`apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts`)

### 8.5 linear-agent

| Current Import                                                          | New Import                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `import { linearActionExtractionPrompt } from '@intexuraos/llm-common'` | `import { linearActionExtractionPrompt } from '@intexuraos/llm-common/classification'` |

**Files to update:** 1 file (`apps/linear-agent/src/infra/llm/linearActionExtractionService.ts`)

### 8.6 todos-agent

| Current Import                                                  | New Import                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `import { itemExtractionPrompt } from '@intexuraos/llm-common'` | `import { itemExtractionPrompt } from '@intexuraos/llm-common/todos'` |

**Files to update:** 1 file (`apps/todos-agent/src/infra/gemini/todoItemExtractionService.ts`)

### 8.7 infra-\* packages (gemini, gpt, claude, glm, perplexity)

| Current Import                                                 | New Import                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `import { buildResearchPrompt } from '@intexuraos/llm-common'` | `import { buildResearchPrompt } from '@intexuraos/llm-common/research'` |

**Files to update:** 5 files (one per infra package)

### 8.8 common-http

| Current Import                                                                         | New Import                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `import { redactToken, redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-common'` | `import { redactToken, redactObject, SENSITIVE_FIELDS } from '@intexuraos/llm-common/shared'` |

**Files to update:** 2 files (`packages/common-http/src/index.ts`, `packages/common-http/src/http/logger.ts`)

### 8.9 llm-contract

| Current Import                                             | New Import                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `import { thumbnailPrompt } from '@intexuraos/llm-common'` | `import { thumbnailPrompt } from '@intexuraos/llm-common/image'` |

**Files to update:** 1 file (`packages/llm-contract/src/helpers.ts`)

### 8.10 Summary

| Consumer              | Files to Update | Complexity |
| --------------------- | --------------- | ---------- |
| research-agent        | 9               | Medium     |
| data-insights-agent   | 6               | Low        |
| commands-agent        | 1               | Trivial    |
| calendar-agent        | 1               | Trivial    |
| linear-agent          | 1               | Trivial    |
| todos-agent           | 1               | Trivial    |
| infra-\* (5 packages) | 5               | Trivial    |
| common-http           | 2               | Trivial    |
| llm-contract          | 1               | Trivial    |
| **Total**             | **27**          | Low-Medium |

### 8.11 package.json Exports Configuration

To enable subpath imports, add to `packages/llm-common/package.json`:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./research": "./dist/research/index.js",
    "./synthesis": "./dist/synthesis/index.js",
    "./classification": "./dist/classification/index.js",
    "./generation": "./dist/generation/index.js",
    "./dataInsights": "./dist/dataInsights/index.js",
    "./validation": "./dist/validation/index.js",
    "./todos": "./dist/todos/index.js",
    "./image": "./dist/image/index.js",
    "./shared": "./dist/shared/index.js"
  }
}
```

---

## 9. Open Questions

1. **Context directory:** The current `context/` directory mixes research and synthesis concerns. Should we create a `contextInference/` shared module instead of splitting? (Decision: Split by domain for clarity)

2. **Attribution ownership:** Attribution is currently only used by research-agent. Should it stay in `research/` or move to `shared/`? (Decision: Keep in `research/` since it's synthesis-specific)

---

## Approval

- [ ] Plan reviewed by maintainer
- [ ] Ready for INT-71 implementation
