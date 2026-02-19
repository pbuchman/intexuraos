# @intexuraos/llm-prompts - Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/llm-prompts
version: 2.1.0
type: module
leaf: false
dependencies: @intexuraos/llm-contract, @intexuraos/common-core, @intexuraos/llm-utils, pino, zod
entry_points:
  - ".": ./src/index.ts
domains: generation, classification, research, synthesis, validation, todos, image, dataInsights, approvals, calendar, linear, shared
```

## Core Interfaces

```typescript
interface PromptDeps {
  currentDate?: () => string;
  maxLength?: number;
  language?: string;
}

interface PromptBuilder<TInput, TDeps extends PromptDeps = PromptDeps> {
  readonly name: string;
  readonly description: string;
  /** Semver string (MAJOR.MINOR.PATCH). CI-enforced via verify:prompt-versions. */
  readonly version: string;
  build(input: TInput, deps?: TDeps): string;
}
```

## Exported PromptBuilder Instances

```typescript
// generation/
const titlePrompt: PromptBuilder<TitlePromptInput, TitlePromptDeps>;
const labelPrompt: PromptBuilder<LabelPromptInput, LabelPromptDeps>;
const feedNamePrompt: PromptBuilder<FeedNamePromptInput, FeedNamePromptDeps>;

// classification/
const commandClassifierPrompt: PromptBuilder<
  CommandClassifierPromptInput,
  CommandClassifierPromptDeps
>;
const intelligentClassifierPrompt: PromptBuilder<
  IntelligentClassifierPromptInput,
  IntelligentClassifierPromptDeps
>;

// validation/
const inputQualityPrompt: PromptBuilder<InputQualityPromptInput, InputQualityPromptDeps>;
const inputImprovementPrompt: PromptBuilder<
  InputImprovementPromptInput,
  InputImprovementPromptDeps
>;

// todos/
const itemExtractionPrompt: PromptBuilder<ItemExtractionPromptInput, ItemExtractionPromptDeps>;

// image/
const thumbnailPrompt: PromptBuilder<ThumbnailPromptInput, ThumbnailPromptDeps>;

// dataInsights/
const dataAnalysisPrompt: PromptBuilder<DataAnalysisPromptInput, DataAnalysisPromptDeps>;
const chartDefinitionPrompt: PromptBuilder<ChartDefinitionPromptInput, ChartDefinitionPromptDeps>;
const dataTransformPrompt: PromptBuilder<DataTransformPromptInput, DataTransformPromptDeps>;

// approvals/
const approvalIntentPrompt: PromptBuilder<ApprovalIntentPromptInput, ApprovalIntentPromptDeps>;

// calendar/
const calendarActionExtractionPrompt: PromptBuilder<
  CalendarEventExtractionPromptInput,
  CalendarEventExtractionPromptDeps
>;
const calendarExtractionRepairPrompt: PromptBuilder<
  CalendarExtractionRepairPromptInput,
  CalendarExtractionRepairPromptDeps
>;

// linear/
const linearActionExtractionPrompt: PromptBuilder<
  LinearIssueExtractionPromptInput,
  LinearIssueExtractionPromptDeps
>;
const linearIssueTitlePrompt: PromptBuilder<
  LinearIssueTitlePromptInput,
  LinearIssueTitlePromptDeps
>;
```

## Exported Functions

```typescript
// research/
function buildResearchPrompt(/* ... */): string;
function buildSynthesisPrompt(/* ... */): string;
function buildInferResearchContextPrompt(/* ... */): string;
function buildResearchContextRepairPrompt(/* ... */): string;
function buildModelExtractionPrompt(/* ... */): string;
function parseModelExtractionResponse(/* ... */): ModelExtractionResponse | null;
function parseModelExtractionResponseWithLogging(logger: Logger, /* ... */): ModelExtractionResponse | null;
function parseAttributionLine(line: string): AttributionLine | null;
function parseSections(content: string): ParsedSection[];
function buildSourceMap(/* ... */): Map<SourceId, SourceMapItem>;
function validateSynthesisAttributions(/* ... */): ValidationResult;
function generateBreakdown(/* ... */): BreakdownEntry[];
function stripAttributionLines(content: string): string;

// synthesis/
function buildInferSynthesisContextPrompt(/* ... */): string;
function buildSynthesisContextRepairPrompt(/* ... */): string;

// validation/
function buildValidationRepairPrompt(/* ... */): string;
function buildImprovementRepairPrompt(/* ... */): string;
function isInputQualityResult(value: unknown): value is InputQualityResult;

// image/
function generateThumbnailPrompt(/* ... */): Result<ThumbnailPrompt, ThumbnailPromptError>;

// dataInsights/
function parseInsightResponse(/* ... */): ParseInsightResult;
function parseChartDefinition(/* ... */): ParsedChartDefinition;
function parseTransformedData(/* ... */): unknown;
function buildInsightRepairPrompt(/* ... */): string;

// approvals/
function parseApprovalIntentResponse(/* ... */): ApprovalIntentResponse | null;
function parseApprovalIntentResponseWithLogging(logger: Logger, /* ... */): ApprovalIntentResponse | null;

// calendar/
function buildCalendarExtractionRepairPrompt(/* ... */): string;

// classification/
function toClassificationExample(/* ... */): ClassificationExample;
function toClassificationCorrection(/* ... */): ClassificationCorrection;

// shared/
function isStringArray(value: unknown): value is string[];
function isObject(value: unknown): value is Record<string, unknown>;
function isDomain(value: unknown): value is Domain;
function isMode(value: unknown): value is Mode;
function isDefaultApplied(value: unknown): value is DefaultApplied;
function isSafetyInfo(value: unknown): value is SafetyInfo;
```

## Exported Zod Schemas

```typescript
// classification/
const CommandClassificationSchema: ZodSchema<CommandClassification>;

// research/
const AnswerStyleSchema, SourceTypeSchema, AvoidSourceTypeSchema: ZodSchema;
const TimeScopeSchema, LocaleScopeSchema, ResearchPlanSchema, OutputFormatSchema: ZodSchema;
const ResearchContextSchema: ZodSchema<ResearchContext>;

// synthesis/
const SynthesisGoalSchema, ConflictSeveritySchema, DetectedConflictSchema: ZodSchema;
const SourcePreferenceSchema, SynthesisOutputFormatSchema: ZodSchema;
const SynthesisContextSchema: ZodSchema<SynthesisContext>;

// todos/
const ExtractedItemSchema, TodoExtractionResponseSchema: ZodSchema;

// dataInsights/
const VegaLiteConfigSchema, DataInsightSchema, TransformedDataSchema: ZodSchema;

// calendar/
const CalendarEventSchema: ZodSchema<CalendarEvent>;

// linear/
const LinearIssueDataSchema, LinearIssueTitleSchema, LinearIssueTypeSchema: ZodSchema;

// shared/
const DomainSchema,
  ModeSchema,
  DefaultAppliedSchema,
  SafetyInfoSchema,
  InputQualitySchema: ZodSchema;
```

## Dependency Graph

```
common-core, llm-contract, llm-utils
  <- llm-prompts
       <- infra-claude, infra-gemini, infra-glm, infra-gpt, infra-perplexity
       <- 9 apps (actions-agent, calendar-agent, commands-agent,
                   data-insights-agent, image-service, linear-agent,
                   research-agent, todos-agent, web-agent)
```

## Usage Patterns

```typescript
// Build a prompt
import { titlePrompt } from '@intexuraos/llm-prompts';
const prompt = titlePrompt.build({ content: 'My article text...' }, { maxLength: 60 });

// Validate LLM response with Zod schema
import { CommandClassificationSchema } from '@intexuraos/llm-prompts';
const result = CommandClassificationSchema.safeParse(JSON.parse(llmResponse));
if (!result.success) {
  /* handle validation error */
}

// Use type guards
import { isResearchContext, type ResearchContext } from '@intexuraos/llm-prompts';
if (isResearchContext(parsed)) {
  const ctx: ResearchContext = parsed;
}
```
