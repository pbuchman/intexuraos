# @intexuraos/llm-prompts — Agent Reference

> Machine-readable interface for automated tooling and AI agents.

## Identity

| Attribute | Value                                                                |
| --------- | -------------------------------------------------------------------- |
| Package   | `@intexuraos/llm-prompts`                                            |
| Role      | Centralized LLM prompt library for all IntexuraOS domains            |
| Goal      | Provide typed, versioned, testable prompt builders to every service  |
| Firestore | None — this package has no Firestore access                          |

## Core Interface

```typescript
interface PromptBuilder<TInput, TDeps extends PromptDeps = PromptDeps> {
  readonly name: string;
  readonly description: string;
  readonly version: string;  // semver — bumped when content changes
  build(input: TInput, deps?: TDeps): string;
}

interface PromptDeps {
  currentDate?: () => string;
  maxLength?: number;
  language?: string;
}
```

## Export Map by Domain

### generation

| Export           | Input type                               | Key deps                                       |
| ---------------- | ---------------------------------------- | ---------------------------------------------- |
| `titlePrompt`    | `{ content: string }`                    | `maxLength?`, `wordRange?`, `includeExamples?` |
| `labelPrompt`    | `{ content: string }`                    | `maxLength?`                                   |
| `feedNamePrompt` | `{ name: string; description?: string }` | —                                              |

### classification

| Export                     | Input type                  | Output format                  |
| -------------------------- | --------------------------- | ------------------------------ |
| `commandClassifierPrompt`  | `{ message: string }`       | Single category string         |
| `intelligentPromptBuilder` | `{ message: string }`       | Category with confidence       |

Categories: `'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear' | 'code'`

### research

| Export                  | Input type             | Output format                          |
| ----------------------- | ---------------------- | -------------------------------------- |
| `researchPrompt`        | `ResearchContext`      | Structured research prompt string      |
| `synthesisPrompt`       | `SynthesisInput[]`     | Multi-source synthesis prompt          |
| `modelExtractionPrompt` | `{ message: string }`  | JSON `{ model: LLMModel }`             |
| `repairPrompt`          | `{ query, error }`     | Repair instruction prompt              |

### todos

| Export                 | Input type                | Output format             |
| ---------------------- | ------------------------- | ------------------------- |
| `itemExtractionPrompt` | `{ description: string }` | JSON array of todo items  |

### image

| Export                    | Input type                | Output format             |
| ------------------------- | ------------------------- | ------------------------- |
| `thumbnailPrompt`         | `{ content: string }`     | Image generation prompt   |
| `generateThumbnailPrompt` | `{ title, description }`  | Image generation prompt   |

### dataInsights

| Export                    | Input type           | Output format                    |
| ------------------------- | -------------------- | -------------------------------- |
| `dataAnalysisPrompt`      | `{ data, source }`   | JSON array of up to 5 insights   |
| `chartDefinitionPrompt`   | `{ data, insight }`  | Vega-Lite JSON spec              |
| `dataTransformPrompt`     | `{ data, target }`   | Transformed data JSON            |

### calendar

| Export                           | Input type              | Output format              |
| -------------------------------- | ----------------------- | -------------------------- |
| `calendarActionExtractionPrompt` | `{ message: string }`   | JSON calendar event object |
| `repairPrompt`                   | `{ message, error }`    | Repair instruction         |

### linear

| Export                         | Input type                | Output format                 |
| ------------------------------ | ------------------------- | ----------------------------- |
| `linearActionExtractionPrompt` | `{ description: string }` | JSON Linear issue fields      |
| `linearIssueTitlePrompt`       | `{ description: string }` | Plain title string            |

### approvals

| Export                 | Input type              | Output format                         |
| ---------------------- | ----------------------- | ------------------------------------- |
| `approvalIntentPrompt` | `{ message: string }`   | JSON `{ intent: 'approve'             | 'reject' | 'unclear' }` |

### validation

| Export                             | Input type                  | Output format                            |
| ---------------------------------- | --------------------------- | ---------------------------------------- |
| `inputQualityPrompt`               | `{ query: string }`         | JSON `{ score: number, reason: string }` |
| `inputImprovementPrompt`           | `{ query: string }`         | Improved query string                    |
| `buildInputValidationRepairPrompt` | `{ query, error }`          | Repair instruction                       |

### shared

| Export           | Type       | Purpose                           |
| ---------------- | ---------- | --------------------------------- |
| `PromptBuilder`  | interface  | Base interface for all prompts    |
| `PromptDeps`     | interface  | Base dependency injection type    |
| `DOMAINS`        | string[]   | All recognized domain strings     |
| `MODES`          | string[]   | All recognized mode strings       |
| `DomainSchema`   | Zod schema | Runtime validation for domains    |
| `ModeSchema`     | Zod schema | Runtime validation for modes      |

## Constraints

**Do NOT:**
- Modify prompt content without bumping the `version` field (CI will fail)
- Skip the literal-content injection guard for prompts accepting user-supplied text
- Import directly from sub-paths — use the top-level `@intexuraos/llm-prompts` export

**Requires:**
- `zod` for response schema validation in consumer code
- No runtime services or environment variables — this package is pure computation

## Dependencies

| Package                    | Why Needed                                              |
| -------------------------- | ------------------------------------------------------- |
| `@intexuraos/llm-contract` | `SynthesisInput` and related types                      |
| `@intexuraos/common-core`  | Utility types                                           |
| `@intexuraos/llm-utils`    | Shared LLM utility helpers                              |
| `zod`                      | Response schema validation (Zod schemas exported)       |
| `pino`                     | Logger type for structured logging in context inference |
