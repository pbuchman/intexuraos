# LLM Prompts Extraction Plan

**Linear Issue:** INT-228 (parent) + child issues
**Date:** 2026-01-24
**Status:** Pending Approval

---

## Overview

Extract all prompts from `@intexuraos/llm-common` into a new `@intexuraos/llm-prompts` package, rename remaining utilities to `@intexuraos/llm-utils`, and break the cyclic dependency between `llm-contract` and `llm-common`.

**Breaking Change:** No backward compatibility. All consumers must update imports.

---

## Motivation

### Current Problems

1. **Cyclic Dependency:** `llm-contract` ↔ `llm-common` creates 79 ESLint errors in `web-agent`
2. **Bloated Package:** `llm-common` mixes prompts, parsers, schemas, guards, and utilities
3. **Poor Discoverability:** Finding all prompts requires searching across multiple directories
4. **Semantic Confusion:** "common" implies utilities, but contains domain-specific prompts

### Benefits of New Structure

1. **Single Source of Truth:** All prompts in one reviewable package
2. **No Cycles:** Clean dependency graph
3. **Clear Semantics:** `llm-prompts` = prompts, `llm-utils` = utilities
4. **Domain Organization:** Prompts grouped by business domain

---

## Final Package Structure

### Package Landscape (6 packages)

```
packages/
├── llm-contract/     # Types, interfaces, model registry
├── llm-prompts/      # 🆕 ALL prompts + parsers + schemas
├── llm-utils/        # 🔄 Renamed from llm-common, utilities only
├── llm-factory/      # Client creation
├── llm-pricing/      # Cost tracking
└── llm-audit/        # Call logging
```

### Dependency Graph

```
                    ┌─────────────┐
                    │ common-core │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│llm-contract │    │ llm-pricing │    │  llm-audit  │
│  (types)    │    │   (costs)   │    │  (logging)  │
└──────┬──────┘    └─────────────┘    └─────────────┘
       │
       ├────────────────────┐
       │                    │
       ▼                    ▼
┌─────────────┐      ┌───────────┐
│ llm-prompts │      │ llm-utils │
│ (prompts)   │      │  (utils)  │
└──────┬──────┘      └───────────┘
       │
       ▼
┌─────────────┐
│ llm-factory │
└─────────────┘
```

---

## Package Contents

### `@intexuraos/llm-prompts`

```
packages/llm-prompts/
├── package.json
├── README.md
├── src/
│   ├── index.ts                     # Barrel exports
│   ├── types.ts                     # PromptBuilder<T>, PromptDeps
│   │
│   ├── generation/                  # Content generation prompts
│   │   ├── titlePrompt.ts
│   │   ├── labelPrompt.ts
│   │   ├── feedNamePrompt.ts
│   │   └── __tests__/
│   │
│   ├── classification/              # Intent classification prompts
│   │   ├── commandClassifierPrompt.ts
│   │   ├── calendarActionExtractionPrompt.ts
│   │   ├── linearActionExtractionPrompt.ts
│   │   ├── intelligentPromptBuilder.ts
│   │   └── __tests__/
│   │
│   ├── todos/                       # Todo extraction prompts
│   │   ├── itemExtractionPrompt.ts
│   │   └── __tests__/
│   │
│   ├── image/                       # Image generation prompts
│   │   ├── thumbnailPrompt.ts
│   │   └── __tests__/
│   │
│   ├── validation/                  # Input validation prompts
│   │   ├── inputQualityPrompt.ts
│   │   ├── inputImprovementPrompt.ts
│   │   ├── repairPrompts.ts
│   │   ├── guards.ts
│   │   └── __tests__/
│   │
│   ├── research/                    # Research prompts
│   │   ├── researchPrompt.ts
│   │   ├── contextInferencePrompt.ts
│   │   ├── modelExtractionPrompt.ts
│   │   ├── repairPrompt.ts
│   │   ├── contextSchemas.ts
│   │   ├── contextTypes.ts
│   │   ├── contextGuards.ts
│   │   └── __tests__/
│   │
│   ├── synthesis/                   # Synthesis prompts
│   │   ├── synthesisPrompt.ts
│   │   ├── contextInferencePrompt.ts
│   │   ├── repairPrompt.ts
│   │   ├── contextSchemas.ts
│   │   ├── contextTypes.ts
│   │   ├── contextGuards.ts
│   │   ├── attribution.ts
│   │   └── __tests__/
│   │
│   ├── dataInsights/                # Data insights prompts
│   │   ├── analysisPrompt.ts
│   │   ├── chartDefinitionPrompt.ts
│   │   ├── transformPrompt.ts
│   │   ├── repairPrompt.ts
│   │   ├── parsers.ts
│   │   └── __tests__/
│   │
│   ├── approvals/                   # Approval intent prompts
│   │   ├── approvalIntentPrompt.ts
│   │   └── __tests__/
│   │
│   └── shared/                      # Shared types/schemas
│       ├── contextTypes.ts
│       └── contextSchemas.ts
```

**Dependencies:**

- `@intexuraos/llm-contract` (for LlmModels, ResearchModel types)
- `@intexuraos/common-core` (for Result types)
- `zod` (for schema validation)
- `pino` (for Logger type)

### `@intexuraos/llm-utils`

```
packages/llm-utils/
├── package.json
├── README.md
├── src/
│   ├── index.ts
│   ├── redaction.ts                 # redactToken, redactObject, SENSITIVE_FIELDS
│   ├── parseError.ts                # createLlmParseError, logLlmParseError
│   └── __tests__/
```

**Dependencies:**

- `@intexuraos/common-core` only

---

## Import Migration (Breaking Changes)

### Consumer Updates Required

| Consumer            | Old Import                      | New Import                       |
| ------------------- | ------------------------------- | -------------------------------- |
| research-agent      | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| todos-agent         | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| commands-agent      | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| calendar-agent      | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| linear-agent        | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| data-insights-agent | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| actions-agent       | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| web-agent           | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| image-service       | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-prompts'` |
| llm-contract        | `from '@intexuraos/llm-common'` | Local import (cycle broken)      |
| common-http         | `from '@intexuraos/llm-common'` | `from '@intexuraos/llm-utils'`   |

### Files Affected

- **32 files** importing prompts from `llm-common` in apps
- **~5 files** importing redaction utilities

---

## Implementation Phases

### Phase 1: Create New Packages (Foundation)

| Step | Task                                                            | Files                                         |
| ---- | --------------------------------------------------------------- | --------------------------------------------- |
| 1.1  | Create `llm-prompts` package scaffold                           | package.json, tsconfig.json, vitest.config.ts |
| 1.2  | Create `llm-utils` package scaffold                             | package.json, tsconfig.json, vitest.config.ts |
| 1.3  | Move `PromptBuilder`/`PromptDeps` to `llm-prompts/src/types.ts` | 1 file                                        |

### Phase 2: Migrate Prompts to `llm-prompts`

| Step | Domain         | Files to Move                                                              |
| ---- | -------------- | -------------------------------------------------------------------------- |
| 2.1  | generation     | titlePrompt, labelPrompt, feedNamePrompt + tests                           |
| 2.2  | classification | commandClassifier, calendarAction, linearAction, intelligent + tests       |
| 2.3  | todos          | itemExtractionPrompt + tests                                               |
| 2.4  | image          | thumbnailPrompt + tests                                                    |
| 2.5  | validation     | inputQuality, inputImprovement, guards, repair + tests                     |
| 2.6  | research       | researchPrompt, contextInference, modelExtraction, schemas, guards + tests |
| 2.7  | synthesis      | synthesisPrompt, contextInference, attribution, schemas, guards + tests    |
| 2.8  | dataInsights   | analysis, chartDefinition, transform, parsers, repair + tests              |
| 2.9  | approvals      | approvalIntentPrompt + tests                                               |
| 2.10 | shared         | contextTypes, contextSchemas                                               |

### Phase 3: Migrate Utilities to `llm-utils`

| Step | Task                      | Files                 |
| ---- | ------------------------- | --------------------- |
| 3.1  | Move redaction utilities  | redaction.ts + tests  |
| 3.2  | Move parseError utilities | parseError.ts + tests |

### Phase 4: Break the Cycle

| Step | Task                                              | Details                                           |
| ---- | ------------------------------------------------- | ------------------------------------------------- |
| 4.1  | Update `llm-contract/helpers.ts`                  | Import thumbnailPrompt from llm-prompts or inline |
| 4.2  | Remove `@intexuraos/llm-common` from llm-contract | Update package.json                               |
| 4.3  | Verify no cyclic dependencies                     | Run typecheck                                     |

### Phase 5: Update All Consumers

| Step | Task                               | Files                 |
| ---- | ---------------------------------- | --------------------- |
| 5.1  | Update research-agent imports      | ~10 files             |
| 5.2  | Update data-insights-agent imports | ~6 files              |
| 5.3  | Update commands-agent imports      | ~2 files              |
| 5.4  | Update calendar-agent imports      | ~2 files              |
| 5.5  | Update linear-agent imports        | ~2 files              |
| 5.6  | Update todos-agent imports         | ~2 files              |
| 5.7  | Update actions-agent imports       | ~2 files              |
| 5.8  | Update web-agent imports           | ~2 files              |
| 5.9  | Update image-service imports       | ~4 files              |
| 5.10 | Update common-http imports         | ~2 files              |
| 5.11 | Run full CI verification           | `pnpm run ci:tracked` |

### Phase 6: Cleanup & Documentation

| Step | Task                                              | Details                                  |
| ---- | ------------------------------------------------- | ---------------------------------------- |
| 6.1  | Delete `llm-common` package                       | Remove directory                         |
| 6.2  | Create `llm-prompts/README.md`                    | Package docs with prompt catalog         |
| 6.3  | Create `llm-utils/README.md`                      | Utility functions docs                   |
| 6.4  | Create `llm-factory/README.md`                    | Client creation guide                    |
| 6.5  | Create `docs/architecture/llm-packages.md`        | Comprehensive LLM package guide          |
| 6.6  | Update `docs/architecture/ai-architecture.md`     | Update packages section                  |
| 6.7  | Update `docs/patterns/llm-response-validation.md` | Change llm-common refs                   |
| 6.8  | Mark old plan as superseded                       | `docs/plans/llm-common-restructuring.md` |

---

## Documentation Strategy

### Current Documentation Inventory

| Document                                   | Status   | Action                    |
| ------------------------------------------ | -------- | ------------------------- |
| `docs/architecture/ai-architecture.md`     | Exists   | Update packages section   |
| `docs/patterns/llm-response-validation.md` | Exists   | Update package references |
| `docs/plans/llm-common-restructuring.md`   | Obsolete | Mark as SUPERSEDED        |
| `packages/llm-contract/README.md`          | Exists   | No changes                |
| `packages/llm-audit/README.md`             | Exists   | No changes                |
| `packages/llm-pricing/README.md`           | Exists   | No changes                |
| `packages/llm-common/README.md`            | Missing  | N/A (deleting package)    |
| `packages/llm-factory/README.md`           | Missing  | Create                    |
| `packages/llm-prompts/README.md`           | New      | Create                    |
| `packages/llm-utils/README.md`             | New      | Create                    |
| `docs/architecture/llm-packages.md`        | New      | Create                    |

### New `docs/architecture/llm-packages.md` Structure

```markdown
# LLM Packages

> Complete reference for IntexuraOS LLM infrastructure packages.

## Package Overview

[Table of all 6 packages with purpose]

## Dependency Graph

[Mermaid diagram]

## llm-contract

[Types, interfaces, model registry]

## llm-prompts

[Prompt catalog by domain - all 20+ prompts]

## llm-utils

[Utility functions]

## llm-factory

[Client creation]

## llm-pricing

[Cost tracking]

## llm-audit

[Call logging]

## Adding New Prompts

[Step-by-step guide]

## Adding New Models

[Step-by-step guide]
```

---

## Acceptance Criteria

- [ ] `llm-prompts` package created with all prompts
- [ ] `llm-utils` package created with utilities
- [ ] `llm-common` package deleted
- [ ] Cyclic dependency eliminated (79 ESLint errors resolved)
- [ ] All 32 consumer files updated
- [ ] All tests pass with 95%+ coverage
- [ ] `pnpm run ci:tracked` passes
- [ ] `llm-prompts/README.md` created with prompt catalog
- [ ] `llm-utils/README.md` created
- [ ] `llm-factory/README.md` created
- [ ] `docs/architecture/llm-packages.md` created
- [ ] `docs/architecture/ai-architecture.md` updated
- [ ] `docs/patterns/llm-response-validation.md` updated

---

## Risk Assessment

| Risk                   | Likelihood | Impact | Mitigation                               |
| ---------------------- | ---------- | ------ | ---------------------------------------- |
| Import path breakage   | High       | High   | Systematic find-replace, CI verification |
| Test path breakage     | Medium     | Medium | Update test imports alongside source     |
| Missing exports        | Medium     | Medium | Compare old/new index.ts exports         |
| Type resolution issues | Low        | Medium | Verify TypeScript paths after moves      |

---

## Linear Issue Structure

### Parent Issue

- **INT-228** Fix cyclic dependency between llm-contract and llm-common (update description)

### Child Issues (Tiers)

**Tier 1: Foundation**

- Create llm-prompts and llm-utils package scaffolds

**Tier 2: Prompt Migration**

- Migrate generation prompts to llm-prompts
- Migrate classification prompts to llm-prompts
- Migrate todos prompts to llm-prompts
- Migrate image prompts to llm-prompts
- Migrate validation prompts to llm-prompts
- Migrate research prompts to llm-prompts
- Migrate synthesis prompts to llm-prompts
- Migrate dataInsights prompts to llm-prompts
- Migrate approvals prompts to llm-prompts

**Tier 3: Utility Migration**

- Migrate utilities to llm-utils

**Tier 4: Break Cycle**

- Break llm-contract → llm-common dependency

**Tier 5: Consumer Updates**

- Update all app imports to use llm-prompts

**Tier 6: Cleanup & Docs**

- Delete llm-common and create comprehensive documentation

---

## Approval

- [ ] Plan reviewed by maintainer
- [ ] Ready for Linear issue creation
