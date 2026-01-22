/**
 * @intexuraos/llm-common
 *
 * LLM-specific utilities for prompts, context inference, attribution, and redaction.
 */

// Prompt builder types (from shared)
export { type PromptBuilder, type PromptDeps } from './shared/types.js';

// Generation prompts (title, label, feed name)
export {
  titlePrompt,
  type TitlePromptInput,
  type TitlePromptDeps,
  labelPrompt,
  type LabelPromptInput,
  type LabelPromptDeps,
  feedNamePrompt,
  type FeedNamePromptInput,
  type FeedNamePromptDeps,
} from './generation/index.js';

// Classification prompts
export {
  commandClassifierPrompt,
  type CommandCategory,
  type CommandClassifierPromptInput,
  type CommandClassifierPromptDeps,
  calendarActionExtractionPrompt,
  type CalendarEventExtractionPromptInput,
  type CalendarEventExtractionPromptDeps,
  type ExtractedCalendarEvent,
  linearActionExtractionPrompt,
  type LinearIssueExtractionPromptInput,
  type LinearIssueExtractionPromptDeps,
  type ExtractedLinearIssue,
  intelligentClassifierPrompt,
  type ClassificationExample,
  type ClassificationCorrection,
  type IntelligentClassifierPromptInput,
  type IntelligentClassifierPromptDeps,
  type CommandExampleSource,
  type TransitionSource,
  toClassificationExample,
  toClassificationCorrection,
} from './classification/index.js';

// Todo prompts (item extraction)
export {
  itemExtractionPrompt,
  type ItemExtractionPromptInput,
  type ItemExtractionPromptDeps,
} from './todos/index.js';

// Image prompts (thumbnail generation)
export {
  thumbnailPrompt,
  type ThumbnailPromptInput,
  type ThumbnailPromptDeps,
} from './image/index.js';

// Validation prompts (input quality and improvement)
export {
  inputQualityPrompt,
  type InputQualityPromptInput,
  type InputQualityPromptDeps,
  inputImprovementPrompt,
  type InputImprovementPromptInput,
  type InputImprovementPromptDeps,
  isInputQualityResult,
  getInputQualityGuardError,
  type InputQualityResult,
  buildValidationRepairPrompt,
  buildImprovementRepairPrompt,
} from './validation/index.js';

// Research prompt builder (from research domain)
export { buildResearchPrompt } from './research/researchPrompt.js';

// Synthesis prompt builder (from research domain)
export {
  buildSynthesisPrompt,
  type SynthesisReport,
  type AdditionalSource,
  /** @deprecated Use AdditionalSource instead */
  type ExternalReport,
} from './research/synthesisPrompt.js';

// Context inference - shared types (from shared)
export {
  DOMAINS,
  type Domain,
  type Mode,
  type DefaultApplied,
  type SafetyInfo,
} from './shared/contextTypes.js';

// Context inference - LlmReport type (alias for SynthesisReport)
export { type LlmReport } from './synthesis/contextTypes.js';

// Context inference - research types and guards (from research)
export {
  type AnswerStyle,
  type SourceType,
  type AvoidSourceType,
  type TimeScope,
  type LocaleScope,
  type ResearchPlan,
  type OutputFormat,
  type ResearchContext,
  type InferResearchContextOptions,
  isResearchContext,
  buildInferResearchContextPrompt,
  buildResearchContextRepairPrompt,
} from './research/index.js';

// Context inference - synthesis types and guards (from synthesis)
export {
  type SynthesisGoal,
  type ConflictSeverity,
  type DetectedConflict,
  type SourcePreference,
  type SynthesisOutputFormat,
  type SynthesisContext,
  type InferSynthesisContextParams,
  isSynthesisContext,
  buildInferSynthesisContextPrompt,
  buildSynthesisContextRepairPrompt,
} from './synthesis/index.js';

// Attribution system (from research domain)
export {
  type SourceId,
  type SourceMapItem,
  type AttributionLine,
  type ParsedSection,
  type ValidationResult,
  type BreakdownEntry,
  parseAttributionLine,
  parseSections,
  buildSourceMap,
  validateSynthesisAttributions,
  generateBreakdown,
  stripAttributionLines,
} from './research/attribution.js';

// Model extraction for research (from research domain)
export {
  buildModelExtractionPrompt,
  parseModelExtractionResponse,
  MODEL_KEYWORDS,
  PROVIDER_DEFAULT_MODELS,
  SYNTHESIS_MODELS,
  DEFAULT_SYNTHESIS_MODEL,
  type AvailableModelInfo,
  type ModelExtractionPromptDeps,
  type ModelExtractionResponse,
} from './research/modelExtractionPrompt.js';

// Security utilities (from shared)
export { redactToken, redactObject, SENSITIVE_FIELDS } from './shared/redaction.js';

// LLM parse error utilities (from shared)
export {
  createLlmParseError,
  logLlmParseError,
  withLlmParseErrorLogging,
  createDetailedParseErrorMessage,
  type LlmParseErrorDetails,
} from './shared/parseError.js';

// Data insights prompts and parsers
export {
  dataAnalysisPrompt,
  type DataAnalysisPromptInput,
  type DataAnalysisPromptDeps,
  type ChartTypeInfo,
  parseInsightResponse,
  type ParsedDataInsight,
  type ParseInsightResult,
  chartDefinitionPrompt,
  type ChartDefinitionPromptInput,
  type ChartDefinitionPromptDeps,
  parseChartDefinition,
  type ParsedChartDefinition,
  dataTransformPrompt,
  type DataTransformPromptInput,
  type DataTransformPromptDeps,
  parseTransformedData,
  buildInsightRepairPrompt,
} from './dataInsights/index.js';

// Approval intent prompts (for WhatsApp approval replies)
export {
  approvalIntentPrompt,
  parseApprovalIntentResponse,
  type ApprovalIntentPromptInput,
  type ApprovalIntentPromptDeps,
  type ApprovalIntentResponse,
} from './approvals/index.js';
