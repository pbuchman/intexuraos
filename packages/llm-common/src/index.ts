/**
 * @intexuraos/llm-common
 *
 * LLM-specific utilities for prompts, context inference, attribution, and redaction.
 */

// Prompt builder types
export { type PromptBuilder, type PromptDeps } from './types.js';

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
} from './validation/index.js';

// Research prompt builder
export { buildResearchPrompt } from './researchPrompt.js';

// Synthesis prompt builder
export {
  buildSynthesisPrompt,
  type SynthesisReport,
  type AdditionalSource,
  /** @deprecated Use AdditionalSource instead */
  type ExternalReport,
} from './synthesisPrompt.js';

// Context inference module
export {
  // Types
  DOMAINS,
  type Domain,
  type Mode,
  type AnswerStyle,
  type SourceType,
  type AvoidSourceType,
  type SynthesisGoal,
  type ConflictSeverity,
  type DefaultApplied,
  type TimeScope,
  type LocaleScope,
  type ResearchPlan,
  type OutputFormat,
  type SafetyInfo,
  type ResearchContext,
  type DetectedConflict,
  type SourcePreference,
  type SynthesisOutputFormat,
  type SynthesisContext,
  type LlmReport,
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
  // Guards
  isResearchContext,
  isSynthesisContext,
  // Prompt builders
  buildInferResearchContextPrompt,
  buildInferSynthesisContextPrompt,
} from './context/index.js';

// Attribution system
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
} from './attribution.js';

// Security utilities
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';

// LLM parse error utilities
export {
  createLlmParseError,
  logLlmParseError,
  withLlmParseErrorLogging,
  createDetailedParseErrorMessage,
  type LlmParseErrorDetails,
} from './llm/parseError.js';

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
} from './dataInsights/index.js';
