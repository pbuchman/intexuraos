# @intexuraos/llm-prompts

Centralized library of all LLM prompt templates and builders used across IntexuraOS. Each prompt is a typed object with a `build()` method that produces the prompt string, plus Zod schemas for validating LLM responses.

**Version:** 2.1.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/llm-contract`, `@intexuraos/common-core`, `@intexuraos/llm-utils`, `pino`, `zod`

## Why It Exists

LLM prompts are the most frequently iterated artifacts in the codebase. Centralizing them in one package provides:

- A single place to find and modify any prompt
- Shared `PromptBuilder` interface for consistent prompt construction
- Zod schemas co-located with prompts for validating LLM responses
- Type-safe input/dependency contracts preventing prompt misuse

## Architecture

Prompts are organized by domain. Each domain has an `index.ts` that re-exports all public APIs.

```
src/
  generation/     Title, label, and feed name prompts
  classification/ Command classification and intelligent routing
  research/       Research queries, synthesis, attribution, model extraction
  synthesis/      Multi-source synthesis with conflict detection
  validation/     Input quality scoring and improvement suggestions
  todos/          Todo item extraction from natural language
  image/          Thumbnail generation prompts
  dataInsights/   Data analysis, chart definitions, Vega-Lite configs
  approvals/      Approval intent detection
  calendar/       Calendar event extraction and repair
  linear/         Linear issue extraction and title generation
  shared/         Cross-cutting types, guards, and schemas
```

## Core Pattern: PromptBuilder

Every prompt implements the `PromptBuilder<TInput, TDeps>` interface:

```typescript
interface PromptDeps {
  currentDate?: () => string;
  maxLength?: number;
  language?: string;
}

interface PromptBuilder<TInput, TDeps extends PromptDeps = PromptDeps> {
  readonly name: string;
  readonly description: string;
  /**
   * Semantic version (MAJOR.MINOR.PATCH). Must be bumped when content changes.
   * Enforced by `pnpm run verify:prompt-versions` in CI.
   */
  readonly version: string;
  build(input: TInput, deps?: TDeps): string;
}
```

Usage:

```typescript
import { titlePrompt } from '@intexuraos/llm-prompts';

const prompt = titlePrompt.build(
  { content: 'Article about TypeScript generics...' },
  { maxLength: 60, wordRange: { min: 4, max: 7 } }
);
// Returns a formatted prompt string ready to send to an LLM
```

## API Reference by Domain

### Generation

| Export           | Type            | Purpose                              |
| ---------------- | --------------- | ------------------------------------ |
| `titlePrompt`    | `PromptBuilder` | Generate concise titles from content |
| `labelPrompt`    | `PromptBuilder` | Generate category labels             |
| `feedNamePrompt` | `PromptBuilder` | Generate feed/collection names       |

### Classification

| Export                        | Type            | Purpose                                              |
| ----------------------------- | --------------- | ---------------------------------------------------- |
| `commandClassifierPrompt`     | `PromptBuilder` | Classify user commands into categories               |
| `intelligentClassifierPrompt` | `PromptBuilder` | Classify with examples and correction feedback       |
| `CommandClassificationSchema` | Zod schema      | Validate classification response                     |
| `toClassificationExample`     | Function        | Convert source data to classification example format |
| `toClassificationCorrection`  | Function        | Convert transition data to correction format         |

### Research

| Export                             | Type       | Purpose                                            |
| ---------------------------------- | ---------- | -------------------------------------------------- |
| `buildResearchPrompt`              | Function   | Build research query prompt                        |
| `buildSynthesisPrompt`             | Function   | Build multi-source synthesis prompt                |
| `buildInferResearchContextPrompt`  | Function   | Infer research context from user query             |
| `buildResearchContextRepairPrompt` | Function   | Repair malformed research context JSON             |
| `buildModelExtractionPrompt`              | Function   | Extract model preferences from user input          |
| `parseModelExtractionResponse`            | Function   | Parse model extraction LLM response                |
| `parseModelExtractionResponseWithLogging` | Function   | Parse with structured error logging via logger     |
| `parseAttributionLine`             | Function   | Parse `[S1,S2]` attribution markers                |
| `parseSections`                    | Function   | Parse synthesized content into attributed sections |
| `buildSourceMap`                   | Function   | Build source ID to metadata mapping                |
| `validateSynthesisAttributions`    | Function   | Validate all attributions reference real sources   |
| `generateBreakdown`                | Function   | Generate per-source usage breakdown                |
| `stripAttributionLines`            | Function   | Remove attribution markers from output             |
| `ResearchContextSchema`            | Zod schema | Validate inferred research context                 |

Research context types: `AnswerStyle`, `SourceType`, `AvoidSourceType`, `TimeScope`, `LocaleScope`, `ResearchPlan`, `OutputFormat`, `ResearchContext`

### Synthesis

| Export                              | Type       | Purpose                                 |
| ----------------------------------- | ---------- | --------------------------------------- |
| `buildInferSynthesisContextPrompt`  | Function   | Infer synthesis context from inputs     |
| `buildSynthesisContextRepairPrompt` | Function   | Repair malformed synthesis context JSON |
| `SynthesisContextSchema`            | Zod schema | Validate inferred synthesis context     |

Synthesis context types: `SynthesisGoal`, `ConflictSeverity`, `DetectedConflict`, `SourcePreference`, `SynthesisOutputFormat`, `SynthesisContext`

### Validation

| Export                         | Type            | Purpose                                  |
| ------------------------------ | --------------- | ---------------------------------------- |
| `inputQualityPrompt`           | `PromptBuilder` | Score input quality (0-2)                |
| `inputImprovementPrompt`       | `PromptBuilder` | Suggest input improvements               |
| `buildValidationRepairPrompt`  | Function        | Repair malformed validation response     |
| `buildImprovementRepairPrompt` | Function        | Repair malformed improvement response    |
| `isInputQualityResult`         | Guard           | Type guard for quality result validation |

### Todos

| Export                         | Type            | Purpose                                  |
| ------------------------------ | --------------- | ---------------------------------------- |
| `itemExtractionPrompt`         | `PromptBuilder` | Extract todo items from natural language |
| `ExtractedItemSchema`          | Zod schema      | Validate single extracted item           |
| `TodoExtractionResponseSchema` | Zod schema      | Validate full extraction response        |

### Image

| Export                    | Type            | Purpose                                   |
| ------------------------- | --------------- | ----------------------------------------- |
| `thumbnailPrompt`         | `PromptBuilder` | Generate image description for thumbnails |
| `generateThumbnailPrompt` | Function        | Build DALL-E style thumbnail prompt       |

### Data Insights

| Export                     | Type            | Purpose                                  |
| -------------------------- | --------------- | ---------------------------------------- |
| `dataAnalysisPrompt`       | `PromptBuilder` | Analyze data and suggest insights        |
| `chartDefinitionPrompt`    | `PromptBuilder` | Generate chart configurations            |
| `dataTransformPrompt`      | `PromptBuilder` | Transform data for visualization         |
| `parseInsightResponse`     | Function        | Parse data insight LLM response          |
| `parseChartDefinition`     | Function        | Parse chart definition from LLM response |
| `parseTransformedData`     | Function        | Parse transformed data from LLM response |
| `buildInsightRepairPrompt` | Function        | Repair malformed insight response        |
| `VegaLiteConfigSchema`     | Zod schema      | Validate Vega-Lite chart configuration   |
| `DataInsightSchema`        | Zod schema      | Validate data insight                    |
| `TransformedDataSchema`    | Zod schema      | Validate transformed data                |

### Approvals

| Export                                    | Type            | Purpose                                             |
| ----------------------------------------- | --------------- | --------------------------------------------------- |
| `approvalIntentPrompt`                    | `PromptBuilder` | Detect approval/rejection intent                    |
| `parseApprovalIntentResponse`             | Function        | Parse approval detection response (throws on error) |
| `parseApprovalIntentResponseWithLogging`  | Function        | Parse with structured error logging via logger      |

### Calendar

| Export                                | Type            | Purpose                               |
| ------------------------------------- | --------------- | ------------------------------------- |
| `calendarActionExtractionPrompt`      | `PromptBuilder` | Extract calendar events from text     |
| `calendarExtractionRepairPrompt`      | `PromptBuilder` | Repair malformed calendar extraction  |
| `buildCalendarExtractionRepairPrompt` | Function        | Build repair prompt for calendar JSON |
| `CalendarEventSchema`                 | Zod schema      | Validate extracted calendar event     |

### Linear

| Export                         | Type            | Purpose                             |
| ------------------------------ | --------------- | ----------------------------------- |
| `linearActionExtractionPrompt` | `PromptBuilder` | Extract Linear issue data from text |
| `linearIssueTitlePrompt`       | `PromptBuilder` | Generate Linear issue titles        |
| `LinearIssueDataSchema`        | Zod schema      | Validate extracted issue data       |
| `LinearIssueTitleSchema`       | Zod schema      | Validate generated title            |
| `LinearIssueTypeSchema`        | Zod schema      | Validate issue type classification  |

### Shared

| Export               | Type       | Purpose                             |
| -------------------- | ---------- | ----------------------------------- |
| `PromptBuilder`      | Type       | Core prompt builder interface       |
| `PromptDeps`         | Type       | Base dependency injection interface |
| `DomainSchema`       | Zod schema | Validate domain enum                |
| `ModeSchema`         | Zod schema | Validate mode enum                  |
| `SafetyInfoSchema`   | Zod schema | Validate safety classification      |
| `InputQualitySchema` | Zod schema | Validate input quality assessment   |

Shared types: `Domain`, `Mode`, `DefaultApplied`, `SafetyInfo`, `InputQuality`

## Used By

**Packages (5):** `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`

**Apps (9):** `actions-agent`, `calendar-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

## Recent Changes

| Commit   | Description                                               | Age     |
| -------- | --------------------------------------------------------- | ------- |
| c2ad13fb | Fix(llm-prompts): address PR review findings              | 1 day   |
| 884bc168 | Add semver versioning to PromptBuilder interface (CI-enforced) | 1 day   |
| f451d51a | Audit and improve 27 prompts across all domains           | 1 day   |
| 44017d5c | Fix ESLint OOM with batched parallel lint runner          | 7 days  |
| 40d83a23 | Implement Intex Chat MVP                                  | 7 days  |

## Source Files

| File                  | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `src/index.ts`        | Re-exports all domain modules                   |
| `src/types.ts`        | PromptBuilder and PromptDeps interfaces         |
| `src/generation/`     | Title, label, feed name prompt builders         |
| `src/classification/` | Command classification prompts and schemas      |
| `src/research/`       | Research, synthesis, attribution, model extract |
| `src/synthesis/`      | Multi-source synthesis context and repair       |
| `src/validation/`     | Input quality and improvement prompts           |
| `src/todos/`          | Todo item extraction prompt and schemas         |
| `src/image/`          | Thumbnail generation prompts                    |
| `src/dataInsights/`   | Data analysis, charts, Vega-Lite prompts        |
| `src/approvals/`      | Approval intent detection                       |
| `src/calendar/`       | Calendar event extraction and repair            |
| `src/linear/`         | Linear issue extraction and title generation    |
| `src/shared/`         | Cross-cutting types, guards, schemas            |
