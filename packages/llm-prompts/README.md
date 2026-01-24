# @intexuraos/llm-prompts

Centralized package for all LLM prompts used across IntexuraOS services.

## Overview

This package contains prompt builders, schemas, parsers, and type guards for LLM operations. It provides a consistent interface for constructing prompts and validating responses.

## Installation

```bash
pnpm add @intexuraos/llm-prompts
```

## Prompt Catalog

### Generation Prompts

Generate titles, labels, and names from content.

| Prompt           | Purpose                             | Input Type            |
| ---------------- | ----------------------------------- | --------------------- |
| `titlePrompt`    | Generate concise titles for content | `TitlePromptInput`    |
| `labelPrompt`    | Generate labels for categorization  | `LabelPromptInput`    |
| `feedNamePrompt` | Generate names for data feeds       | `FeedNamePromptInput` |

```typescript
import { titlePrompt } from '@intexuraos/llm-prompts';

const prompt = titlePrompt.build({ content: 'Article about AI...' });
```

### Classification Prompts

Classify user input and extract structured data.

| Prompt                           | Purpose                               | Input Type                           |
| -------------------------------- | ------------------------------------- | ------------------------------------ |
| `commandClassifierPrompt`        | Classify user commands                | `CommandClassifierPromptInput`       |
| `calendarActionExtractionPrompt` | Extract calendar events               | `CalendarEventExtractionPromptInput` |
| `linearActionExtractionPrompt`   | Extract Linear issues                 | `LinearIssueExtractionPromptInput`   |
| `intelligentClassifierPrompt`    | Adaptive classification with examples | `IntelligentClassifierPromptInput`   |

```typescript
import { commandClassifierPrompt } from '@intexuraos/llm-prompts';

const prompt = commandClassifierPrompt.build({
  userCommand: 'remind me to call mom tomorrow',
  availableCategories: ['todo', 'calendar', 'note'],
});
```

### Validation Prompts

Validate and improve user input quality.

| Prompt                         | Purpose                   | Input Type                    |
| ------------------------------ | ------------------------- | ----------------------------- |
| `inputQualityPrompt`           | Assess input quality      | `InputQualityPromptInput`     |
| `inputImprovementPrompt`       | Suggest improvements      | `InputImprovementPromptInput` |
| `buildValidationRepairPrompt`  | Repair failed validation  | Function                      |
| `buildImprovementRepairPrompt` | Repair failed improvement | Function                      |

```typescript
import { inputQualityPrompt, isInputQualityResult } from '@intexuraos/llm-prompts';

const prompt = inputQualityPrompt.build({ userInput: 'research AI' });
// Parse response with type guard
if (isInputQualityResult(parsed)) {
  console.log(parsed.quality_score);
}
```

### Research Prompts

Build research queries and handle context inference.

| Prompt                             | Purpose                         |
| ---------------------------------- | ------------------------------- |
| `buildResearchPrompt`              | Construct research queries      |
| `buildInferResearchContextPrompt`  | Infer context from query        |
| `buildResearchContextRepairPrompt` | Repair failed context inference |
| `buildModelExtractionPrompt`       | Extract model preferences       |

```typescript
import { buildResearchPrompt } from '@intexuraos/llm-prompts';

const prompt = buildResearchPrompt('What is quantum computing?');
```

### Synthesis Prompts

Synthesize multiple LLM responses with attribution.

| Prompt                              | Purpose                          |
| ----------------------------------- | -------------------------------- |
| `buildSynthesisPrompt`              | Combine multiple model responses |
| `buildInferSynthesisContextPrompt`  | Infer synthesis context          |
| `buildSynthesisContextRepairPrompt` | Repair failed synthesis context  |

```typescript
import { buildSynthesisPrompt, type SynthesisReport } from '@intexuraos/llm-prompts';

const reports: SynthesisReport[] = [
  { model: 'gemini', content: 'Response from Gemini...' },
  { model: 'claude', content: 'Response from Claude...' },
];

const prompt = buildSynthesisPrompt('Original query', reports);
```

### Attribution Utilities

Parse and validate source attributions in synthesis output.

| Function                        | Purpose                        |
| ------------------------------- | ------------------------------ |
| `parseSections`                 | Parse markdown sections        |
| `buildSourceMap`                | Build model→source mapping     |
| `validateSynthesisAttributions` | Validate all attributions      |
| `generateBreakdown`             | Generate attribution breakdown |
| `stripAttributionLines`         | Remove attribution markers     |

### Data Insights Prompts

Analyze data and generate chart definitions.

| Prompt                     | Purpose                    | Input Type                   |
| -------------------------- | -------------------------- | ---------------------------- |
| `dataAnalysisPrompt`       | Analyze data patterns      | `DataAnalysisPromptInput`    |
| `chartDefinitionPrompt`    | Define chart configuration | `ChartDefinitionPromptInput` |
| `dataTransformPrompt`      | Transform data formats     | `DataTransformPromptInput`   |
| `buildInsightRepairPrompt` | Repair failed parsing      | Function                     |

**Parsers:**

- `parseInsightResponse` - Parse analysis results
- `parseChartDefinition` - Parse chart configs
- `parseTransformedData` - Parse transformed data

### Image Prompts

Generate prompts for image creation.

| Prompt                    | Purpose                           | Input Type                  |
| ------------------------- | --------------------------------- | --------------------------- |
| `thumbnailPrompt`         | Generate thumbnail descriptions   | `ThumbnailPromptInput`      |
| `generateThumbnailPrompt` | Generate image generation prompts | `ThumbnailPromptParameters` |

### Approval Prompts

Handle user approval flows.

| Prompt                 | Purpose                  | Input Type                  |
| ---------------------- | ------------------------ | --------------------------- |
| `approvalIntentPrompt` | Classify approval intent | `ApprovalIntentPromptInput` |

**Parser:** `parseApprovalIntentResponse`

### Todos Prompts

Extract todo items from natural language.

| Prompt                 | Purpose            | Input Type                  |
| ---------------------- | ------------------ | --------------------------- |
| `itemExtractionPrompt` | Extract todo items | `ItemExtractionPromptInput` |

## Zod Schemas

All context types have corresponding Zod schemas for validation:

```typescript
import {
  ResearchContextSchema,
  SynthesisContextSchema,
  DomainSchema,
  ModeSchema,
} from '@intexuraos/llm-prompts';

const result = ResearchContextSchema.safeParse(response);
if (result.success) {
  const context = result.data; // Typed as ResearchContext
}
```

### Available Schemas

**Research:**

- `AnswerStyleSchema`, `SourceTypeSchema`, `TimeScopeSchema`
- `ResearchPlanSchema`, `OutputFormatSchema`, `ResearchContextSchema`

**Synthesis:**

- `SynthesisGoalSchema`, `ConflictSeveritySchema`
- `DetectedConflictSchema`, `SynthesisContextSchema`

**Shared:**

- `DomainSchema`, `ModeSchema`, `DefaultAppliedSchema`, `SafetyInfoSchema`

## Type Guards

Runtime type checking for parsed responses:

```typescript
import { isResearchContext, isSynthesisContext } from '@intexuraos/llm-prompts';

if (isResearchContext(parsed)) {
  // TypeScript knows parsed is ResearchContext
}
```

## Adding New Prompts

1. Create a new file in the appropriate domain directory:

   ```
   packages/llm-prompts/src/<domain>/<promptName>.ts
   ```

2. Export types and the prompt builder:

   ```typescript
   export interface MyPromptInput { ... }
   export interface MyPromptDeps { ... }

   export const myPrompt: PromptBuilder<MyPromptInput> = {
     build: (input: MyPromptInput, deps?: MyPromptDeps) => string;
   };
   ```

3. Add tests in `__tests__/<promptName>.test.ts`

4. Export from the domain's `index.ts`

5. Ensure 95% test coverage

## Dependencies

- `@intexuraos/llm-contract` - Shared types and models
- `@intexuraos/common-core` - Result types
- `zod` - Schema validation
